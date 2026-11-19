/**
 * Tests for session management (utils/sessions.js), run with: npm test. No database needed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../utils/sessions');

test('devices are named from the browser and system', () => {
  const ua = {
    edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
    firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  };
  assert.equal(S.describeAgent(ua.edgeWin), 'Edge on Windows');
  assert.equal(S.describeAgent(ua.chromeAndroid), 'Chrome on Android');
  assert.equal(S.describeAgent(ua.safariIphone), 'Safari on iPhone');
  assert.equal(S.describeAgent(ua.chromeIphone), 'Chrome on iPhone');
  assert.equal(S.describeAgent(ua.firefoxMac), 'Firefox on Mac');
  assert.equal(S.describeAgent(ua.samsung), 'Samsung Internet on Android');
  assert.equal(S.describeAgent('curl/8.4.0'), 'A script or app');
  assert.equal(S.describeAgent(''), 'Unknown device');
});

test('a session as the pages show it: open, ended, expired, this device', () => {
  const now = new Date('2026-11-20T08:00:00Z');
  const base = { _id: 'a1', portal: 'admin', method: 'password', userAgent: 'curl/8', ip: '203.0.113.5', lastSeenIp: '203.0.113.9',
    createdAt: new Date('2026-11-19T08:00:00Z'), lastSeenAt: new Date('2026-11-20T07:55:00Z'), expiresAt: new Date('2026-11-26T08:00:00Z'), endedAt: null };
  const open = S.view(base, 'a1', now);
  assert.deepEqual([open.active, open.current, open.ip, open.signedInIp, open.endReason], [true, true, '203.0.113.9', '203.0.113.5', '']);
  const ended = S.view({ ...base, endedAt: new Date('2026-11-20T07:00:00Z'), endReason: 'Ended by an admin', endedByName: 'Ana Reyes' }, 'zz', now);
  assert.deepEqual([ended.active, ended.current, ended.endReason, ended.endedByName], [false, false, 'Ended by an admin', 'Ana Reyes']);
  const expired = S.view({ ...base, expiresAt: new Date('2026-11-20T07:59:00Z') }, null, now);
  assert.deepEqual([expired.active, expired.endReason], [false, 'Expired']);
  assert.equal('user' in open, false, 'no account details unless the user was loaded');
  const withUser = S.view({ ...base, user: { _id: 'u1', firstName: 'Ana', lastName: 'Reyes', email: 'ana@example.com', role: 'admin' } }, null, now);
  assert.deepEqual(withUser.user, { id: 'u1', name: 'Ana Reyes', email: 'ana@example.com', role: 'admin' });
});

test('a token without a session id is refused (signed in before sessions existed)', async () => {
  assert.deepEqual(await S.check({ id: 'u1' }, {}), { ok: false, message: 'Please sign in again.' });
  assert.deepEqual(await S.check({ id: 'u1', sid: 'not-an-id' }, {}), { ok: false, message: 'Please sign in again.' });
});
