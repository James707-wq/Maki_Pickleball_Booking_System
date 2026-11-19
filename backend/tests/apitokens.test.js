/**
 * Tests for the API tokens (utils/apiTokens.js, middleware/apiToken.js), run with: npm test.
 * No database: the token model's lookups are replaced by small stand-ins.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const ApiToken = require('../models/ApiToken');
const T = require('../utils/apiTokens');
const { apiTokenAuth, requireScope, tokenRateLimit } = require('../middleware/apiToken');

const API_LIMIT = { limit: 300, windowSeconds: 60, text: '300 per minute' };
const NOW = new Date('2026-11-17T02:00:00.000Z');
let existing = { sameName: false, active: 0 };
ApiToken.exists = async () => (existing.sameName ? { _id: 'x' } : null);
ApiToken.countDocuments = async () => existing.active;
const check = (body) => T.checkSettings(body, { apiLimit: API_LIMIT, now: NOW });
const good = { name: 'Door panel', scopes: ['checkins:write'], rateLimit: { limit: 20, window: 'minute' }, expires: { days: 90 } };

test('a token is mkp_ + 43 random characters; only its hash and first characters are kept', () => {
  const a = T.newToken();
  const b = T.newToken();
  assert.match(a.token, T.TOKEN_RE);
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, crypto.createHash('sha256').update(a.token).digest('hex'));
  assert.equal(a.prefix, a.token.slice(0, 12));
});

test('good settings pass, tidied up', async () => {
  existing = { sameName: false, active: 0 };
  const r = await check({ ...good, name: '  Door   panel ', scopes: ['checkins:write', 'courts:read', 'courts:read'] });
  assert.equal(r.problems, undefined);
  assert.equal(r.settings.name, 'Door panel');
  assert.deepEqual(r.settings.scopes, ['courts:read', 'checkins:write']);
  assert.deepEqual(r.settings.rateLimit, { limit: 20, window: 'minute' });
  assert.equal(r.settings.expiresAt.getTime(), NOW.getTime() + 90 * 864e5);
  assert.equal((await check({ ...good, expires: { never: true } })).settings.expiresAt, null);
});

test('every problem is reported at once, before anything is saved', async () => {
  existing = { sameName: false, active: 0 };
  const r = await check({ name: '', scopes: [], rateLimit: { limit: 5, window: 'week' }, expires: {} });
  assert.deepEqual(r.problems, [
    'Give the token a name, e.g. "Door panel" or "Bookings sheet"',
    'Choose what the token may do',
    'Choose a rate limit per minute, hour or day',
    'Choose when the token expires',
  ]);
  assert.equal(r.settings, undefined);
});

test('permissions: known ones only, and contact details only with bookings', async () => {
  assert.ok((await check({ ...good, scopes: ['bookings:write'] })).problems.includes('Some of the permissions are not known'));
  assert.ok((await check({ ...good, scopes: ['customers:read'] })).problems.some((p) => /only works together with "See bookings"/.test(p)));
  assert.equal((await check({ ...good, scopes: ['bookings:read', 'customers:read'] })).problems, undefined);
});

test("a token's rate limit can't be more than the API allows anyone", async () => {
  assert.match((await check({ ...good, rateLimit: { limit: 400, window: 'minute' } })).problems[0], /more than the API allows anyone \(300 per minute\): use at most 300 per minute/);
  assert.equal((await check({ ...good, rateLimit: { limit: 18000, window: 'hour' } })).problems, undefined);
  assert.match((await check({ ...good, rateLimit: { limit: 18001, window: 'hour' } })).problems[0], /use at most 18000 per hour/);
  assert.match((await check({ ...good, rateLimit: { limit: 2.5, window: 'minute' } })).problems[0], /whole number from 1 to 100000/);
  const noApiLimit = await T.checkSettings({ ...good, rateLimit: { limit: 5000, window: 'minute' } }, { apiLimit: null, now: NOW });
  assert.equal(noApiLimit.problems, undefined, 'with RATE_LIMIT_API off there is no cap');
});

test('expiry: a real future date, at most a year away', async () => {
  const r = await check({ ...good, expires: { date: '2026-12-31' } });
  assert.equal(r.settings.expiresAt.toISOString(), '2026-12-31T15:59:59.999Z', 'the end of that day in Manila');
  assert.ok((await check({ ...good, expires: { date: '2026-11-01' } })).problems.includes('The expiry date must be in the future'));
  assert.ok((await check({ ...good, expires: { date: '2028-01-01' } })).problems.includes('The expiry date can be at most a year from today'));
  assert.ok((await check({ ...good, expires: { date: '2027-02-30' } })).problems.includes('The expiry date is not a real date'));
  assert.ok((await check({ ...good, expires: { days: 45 } })).problems.includes('Choose when the token expires'));
});

test('no two active tokens with the same name, and at most 20 in use', async () => {
  existing = { sameName: true, active: 3 };
  assert.match((await check(good)).problems[0], /already a token called "Door panel"/);
  existing = { sameName: false, active: T.MAX_ACTIVE };
  assert.match((await check(good)).problems[0], /already 20 tokens in use/);
  existing = { sameName: false, active: 0 };
});

test('the summary admins confirm, and the list never shows the hash', () => {
  const s = { name: 'Door panel', scopes: ['courts:read', 'checkins:write'], rateLimit: { limit: 20, window: 'minute' }, expiresAt: new Date('2027-02-15T15:59:59.999Z') };
  assert.equal(T.describe(s), 'Make API token "Door panel": see courts and their free times and check customers in; 20 per minute; expires Feb 15, 2027');
  assert.equal(T.describe({ ...s, expiresAt: null }).endsWith('never expires'), true);
  const v = T.view({ _id: 'a1', ...s, prefix: 'mkp_abcdefgh', hash: 'secret-hash', expiresAt: new Date('2020-01-01'), revokedAt: null });
  assert.equal(v.status, 'expired');
  assert.equal(JSON.stringify(v).includes('secret-hash'), false);
  assert.equal(T.view({ _id: 'a2', ...s, prefix: 'p', revokedAt: new Date() }).status, 'revoked');
});

/* ---------- the /api/v1 gatekeeper, over HTTP ---------- */
const tokens = new Map(); // hash -> token document
function addToken(fields) {
  const { token, hash, prefix } = T.newToken();
  tokens.set(hash, { _id: `id-${prefix}`, prefix, revokedAt: null, expiresAt: null, lastUsedAt: null, scopes: ['bookings:read'], rateLimit: { limit: 100, window: 'minute' }, ...fields });
  return token;
}
async function gate() {
  const realFind = ApiToken.findOne;
  const realUpdate = ApiToken.updateOne;
  const updates = [];
  ApiToken.findOne = async (q) => tokens.get(q.hash) || null;
  ApiToken.updateOne = async (q) => { updates.push(q._id); };
  const app = express();
  app.use('/api/v1', apiTokenAuth, tokenRateLimit);
  app.get('/api/v1/bookings', requireScope('bookings:read'), (req, res) => res.json({ success: true, token: req.apiToken.name }));
  app.post('/api/v1/check-ins', requireScope('checkins:write'), (req, res) => res.json({ success: true }));
  const s = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  const call = async (method, path, token) => {
    const res = await fetch(`http://127.0.0.1:${s.address().port}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, headers: res.headers, json: await res.json() };
  };
  return { call, updates, close: () => { s.closeAllConnections(); s.close(); ApiToken.findOne = realFind; ApiToken.updateOne = realUpdate; } };
}

test('/api/v1 refuses missing, unknown, revoked and expired tokens with a clear code', async () => {
  const g = await gate();
  try {
    assert.equal((await g.call('GET', '/api/v1/bookings')).json.code, 'TOKEN_MISSING');
    assert.equal((await g.call('GET', '/api/v1/bookings', 'not-a-token')).json.code, 'TOKEN_INVALID');
    assert.equal((await g.call('GET', '/api/v1/bookings', T.newToken().token)).json.code, 'TOKEN_INVALID', 'well formed, but never made');
    const revoked = await g.call('GET', '/api/v1/bookings', addToken({ name: 'Old', revokedAt: new Date('2026-11-10T00:00:00Z') }));
    assert.deepEqual([revoked.status, revoked.json.code], [401, 'TOKEN_REVOKED']);
    assert.match(revoked.json.message, /revoked on Nov 10, 2026/);
    const expired = await g.call('GET', '/api/v1/bookings', addToken({ name: 'Late', expiresAt: new Date('2026-01-01T00:00:00Z') }));
    assert.deepEqual([expired.status, expired.json.code], [401, 'TOKEN_EXPIRED']);
  } finally { g.close(); }
});

test('a token may only do what it was given, and each token has its own rate limit', async () => {
  const g = await gate();
  try {
    const sheet = addToken({ name: 'Bookings sheet', scopes: ['bookings:read'], rateLimit: { limit: 2, window: 'minute' } });
    const panel = addToken({ name: 'Door panel', scopes: ['checkins:write'], rateLimit: { limit: 5, window: 'hour' } });
    const ok = await g.call('GET', '/api/v1/bookings', sheet);
    assert.deepEqual([ok.status, ok.json.token], [200, 'Bookings sheet']);
    assert.match(ok.headers.get('ratelimit'), /limit=2, remaining=1/);
    const no = await g.call('POST', '/api/v1/check-ins', sheet);
    assert.deepEqual([no.status, no.json.code], [403, 'TOKEN_SCOPE']);
    assert.match(no.json.message, /may not check customers in/);
    const over = await g.call('GET', '/api/v1/bookings', sheet);
    assert.deepEqual([over.status, over.json.code, over.json.limit], [429, 'RATE_LIMITED', 'token']);
    assert.match(over.json.message, /made too many requests \(2 per minute\)/);
    assert.ok(Number(over.headers.get('retry-after')) > 0);
    const other = await g.call('POST', '/api/v1/check-ins', panel);
    assert.equal(other.status, 200, 'another token has its own count');
    assert.match(other.headers.get('ratelimit-policy'), /^5;w=3600/);
    assert.deepEqual([...new Set(g.updates)].length, 2, 'last-used is written once per token, not on every request');
  } finally { g.close(); }
});
