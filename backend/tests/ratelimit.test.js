/**
 * Tests for the API rate limits (middleware/rateLimits.js), run with: npm test.
 * No database: a small Express app gets the same limits (made tiny) and is called over HTTP.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-rate-limit-tests';
const R = require('../middleware/rateLimits');

test('limit settings: <requests>/<window>, or off', () => {
  assert.deepEqual(R.parseLimit('30/15m'), { limit: 30, windowMs: 15 * 60000 });
  assert.deepEqual(R.parseLimit('300/1m'), { limit: 300, windowMs: 60000 });
  assert.deepEqual(R.parseLimit('100/h'), { limit: 100, windowMs: 3600000 });
  assert.deepEqual(R.parseLimit(' 5 / 30s '), { limit: 5, windowMs: 30000 });
  assert.equal(R.parseLimit('off'), null);
  assert.equal(R.parseLimit(''), null);
  assert.throws(() => R.parseLimit('300 per minute'), /should look like 30\/15m/);
  assert.throws(() => R.parseLimit('0/1m'), /at least 1 request/);
  assert.throws(() => R.parseLimit('10/0m'), /at least 1 request/);
});

test('a bad setting falls back to the default instead of turning the limit off', () => {
  const log = console.error;
  console.error = () => {};
  try {
    const L = R.createRateLimits({ RATE_LIMIT_API: 'lots' });
    assert.deepEqual(L.specs.api, R.parseLimit(R.DEFAULTS.api));
    assert.match(L.adminView().limits.find((l) => l.name === 'api').source, /not valid/);
  } finally { console.error = log; }
});

test('TRUST_PROXY and IP addresses (IPv6 by its /64 network)', () => {
  assert.equal(R.trustProxySetting(''), false);
  assert.equal(R.trustProxySetting('0'), false);
  assert.equal(R.trustProxySetting('1'), 1);
  assert.equal(R.trustProxySetting('loopback'), 'loopback');
  assert.equal(R.ipKey('203.0.113.5'), '203.0.113.5');
  assert.equal(R.ipKey('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(R.ipKey('2001:db8:abcd:12:1:2:3:4'), '2001:db8:abcd:12::/64');
  assert.equal(R.ipKey('2001:db8:abcd:12:ffff::9'), '2001:db8:abcd:12::/64', 'same /64 network, same bucket');
  assert.equal(R.ipKey('2001:0db8::1'), '2001:db8:0:0::/64');
});

/** A small app with the limits in front of stand-in routes. */
async function server(env, setup) {
  const events = [];
  const app = express();
  if (setup) setup(app);
  const L = R.createRateLimits(env, { onBlocked: (e) => events.push(e) });
  L.mount(app);
  app.post('/api/auth/login', (req, res) => res.json({ success: true }));
  app.get('/api/facility', (req, res) => res.json({ success: true }));
  app.post('/api/issues', (req, res) => res.json({ success: true }));
  app.post('/api/webhooks/hitpay', (req, res) => res.json({ success: true }));
  const s = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const call = async (method, path, { token, headers = {} } = {}) => {
    const res = await fetch(base + path, { method, headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => ({})) };
  };
  const times = async (n, ...args) => { const out = []; for (let i = 0; i < n; i += 1) out.push(await call(...args)); return out; };
  return { L, events, call, times, close: () => { s.closeAllConnections(); s.close(); } };
}
const tokenFor = (id, secret = process.env.JWT_SECRET) => jwt.sign({ id }, secret, { expiresIn: '10m' });

test('over the limit: 429 with Retry-After, RateLimit headers and a plain message', async () => {
  const t = await server({ RATE_LIMIT_API: '3/1m' });
  try {
    const ok = await t.times(3, 'GET', '/api/facility');
    assert.deepEqual(ok.map((r) => r.status), [200, 200, 200]);
    assert.match(ok[2].headers.get('ratelimit'), /limit=3, remaining=0/);
    assert.equal(ok[2].headers.get('ratelimit-policy'), '3;w=60');
    const no = await t.call('GET', '/api/facility');
    assert.equal(no.status, 429);
    assert.ok(Number(no.headers.get('retry-after')) > 0);
    assert.equal(no.json.code, 'RATE_LIMITED');
    assert.equal(no.json.limit, 'api');
    assert.match(no.json.message, /^Too many requests\. Try again in \d+ (seconds?|minutes?)\.$/);
    assert.equal(t.events.length, 1);
    assert.equal(t.events[0].first, true);
    assert.equal(t.events[0].key, 'ip:127.0.0.1');
  } finally { t.close(); }
});

test('signed-in people are counted by account, not by their shared IP address', async () => {
  const t = await server({ RATE_LIMIT_API: '2/1m' });
  try {
    await t.times(2, 'GET', '/api/facility');
    assert.equal((await t.call('GET', '/api/facility')).status, 429, 'the IP address is used up');
    const a = tokenFor('65a0000000000000000000a1');
    const b = tokenFor('65a0000000000000000000b2');
    assert.deepEqual((await t.times(2, 'GET', '/api/facility', { token: a })).map((r) => r.status), [200, 200], 'account A has its own count');
    assert.equal((await t.call('GET', '/api/facility', { token: a })).status, 429);
    assert.equal((await t.call('GET', '/api/facility', { token: b })).status, 200, 'account B is not affected');
    const forged = tokenFor('65a0000000000000000000c3', 'not-the-server-secret');
    assert.equal((await t.call('GET', '/api/facility', { token: forged })).status, 429, 'a forged token counts as the IP address');
  } finally { t.close(); }
});

test('creating things has its own, smaller limit', async () => {
  const t = await server({ RATE_LIMIT_API: '50/1m', RATE_LIMIT_CREATE: '2/1m' });
  try {
    const a = tokenFor('65a0000000000000000000a1');
    const b = tokenFor('65a0000000000000000000b2');
    assert.deepEqual((await t.times(2, 'POST', '/api/issues', { token: a })).map((r) => r.status), [200, 200]);
    const no = await t.call('POST', '/api/issues', { token: a });
    assert.equal(no.status, 429);
    assert.equal(no.json.limit, 'create');
    assert.match(no.json.message, /^You are doing that too often\./);
    assert.equal((await t.call('GET', '/api/facility', { token: a })).status, 200, 'reading is still fine');
    assert.equal((await t.call('POST', '/api/issues', { token: b })).status, 200, 'another account is not affected');
  } finally { t.close(); }
});

test('sign-in has its own limit per IP address and does not use up the general one', async () => {
  const t = await server({ RATE_LIMIT_AUTH: '2/1m', RATE_LIMIT_API: '3/1m' });
  try {
    assert.deepEqual((await t.times(2, 'POST', '/api/auth/login')).map((r) => r.status), [200, 200]);
    const no = await t.call('POST', '/api/auth/login');
    assert.equal(no.status, 429);
    assert.equal(no.json.limit, 'auth');
    assert.match(no.json.message, /^Too many sign-in attempts from your network\./);
    assert.equal((await t.call('GET', '/api/facility')).status, 200, 'sign-in requests are not counted twice');
  } finally { t.close(); }
});

test('the HitPay webhook is never limited', async () => {
  const t = await server({ RATE_LIMIT_API: '2/1m' });
  try {
    const all = await t.times(6, 'POST', '/api/webhooks/hitpay');
    assert.ok(all.every((r) => r.status === 200));
  } finally { t.close(); }
});

test('GET /api/rate-limit shows where the caller stands and is not counted itself', async () => {
  const t = await server({ RATE_LIMIT_API: '5/1m', RATE_LIMIT_CREATE: 'off' });
  try {
    await t.times(2, 'GET', '/api/facility');
    const first = await t.call('GET', '/api/rate-limit');
    const second = await t.call('GET', '/api/rate-limit');
    assert.equal(first.status, 200);
    const api = first.json.limits.find((l) => l.name === 'api');
    assert.deepEqual({ limit: api.limit, used: api.used, remaining: api.remaining, windowSeconds: api.windowSeconds, countedBy: api.countedBy },
      { limit: 5, used: 2, remaining: 3, windowSeconds: 60, countedBy: 'ip address' });
    assert.ok(api.resetsAt);
    assert.equal(second.json.limits.find((l) => l.name === 'api').used, 2, 'asking does not count');
    assert.equal(first.json.limits.find((l) => l.name === 'create').off, true);
    const mine = await t.call('GET', '/api/rate-limit', { token: tokenFor('65a0000000000000000000a1') });
    assert.equal(mine.json.limits.find((l) => l.name === 'api').countedBy, 'account');
  } finally { t.close(); }
});

test('the admin view lists the limits and who was refused', async () => {
  const t = await server({ RATE_LIMIT_API: '1/1m', RATE_LIMIT_AUTH: '30/15m' });
  try {
    await t.times(3, 'GET', '/api/facility');
    const v = t.L.adminView();
    const api = v.limits.find((l) => l.name === 'api');
    assert.deepEqual({ limit: api.limit, per: api.per, source: api.source, setting: api.setting }, { limit: 1, per: 'minute', source: 'backend/.env', setting: 'RATE_LIMIT_API' });
    assert.equal(v.limits.find((l) => l.name === 'auth').per, '15 minutes');
    assert.equal(v.limits.find((l) => l.name === 'create').source, 'default');
    assert.equal(v.blocked.length, 1);
    assert.deepEqual({ limit: v.blocked[0].limit, key: v.blocked[0].key, count: v.blocked[0].count, path: v.blocked[0].path },
      { limit: 'api', key: 'ip:127.0.0.1', count: 2, path: 'GET /api/facility' });
  } finally { t.close(); }
});

test('behind a proxy (TRUST_PROXY=1) each visitor is counted by their own address', async () => {
  const t = await server({ RATE_LIMIT_API: '1/1m' }, (app) => app.set('trust proxy', R.trustProxySetting('1')));
  try {
    assert.equal((await t.call('GET', '/api/facility', { headers: { 'X-Forwarded-For': '198.51.100.7' } })).status, 200);
    assert.equal((await t.call('GET', '/api/facility', { headers: { 'X-Forwarded-For': '198.51.100.7' } })).status, 429);
    assert.equal((await t.call('GET', '/api/facility', { headers: { 'X-Forwarded-For': '198.51.100.8' } })).status, 200, 'another visitor behind the same proxy');
  } finally { t.close(); }
});
