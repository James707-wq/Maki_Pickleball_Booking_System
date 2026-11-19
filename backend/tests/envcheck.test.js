/**
 * Tests for the server settings check (utils/envCheck.js), run with: npm test. No database needed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const E = require('../utils/envCheck');

const ID = '627692837898-abc123def456.apps.googleusercontent.com';
const OTHER_ID = '111111111111-zzz999yyy888.apps.googleusercontent.com';
/** Problem messages for these values (everything else blank). */
const problems = (values) => E.findProblems(E.valuesFrom(values)).map((p) => p.message);
const has = (list, re) => list.some((m) => re.test(m));
const pemOnOneLine = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'); // as it is written in backend/.env

test('Google client IDs: a client secret pasted by mistake, a wrong value, the same ID twice', () => {
  assert.deepEqual(problems({ GOOGLE_CLIENT_ID: ID, CUSTOM_GOOGLE_CLIENT_ID: OTHER_ID }), []);
  assert.ok(has(problems({ CUSTOM_GOOGLE_CLIENT_ID: 'GOCSPX-AbCdEfGhIjKlMnOp' }), /^CUSTOM_GOOGLE_CLIENT_ID is a client secret \(it starts with GOCSPX-\)/));
  assert.ok(has(problems({ GOOGLE_CLIENT_ID: '627692837898' }), /^GOOGLE_CLIENT_ID should be a client ID ending in \.apps\.googleusercontent\.com/));
  assert.ok(has(problems({ GOOGLE_CLIENT_ID: ID, CUSTOM_GOOGLE_CLIENT_ID: ID }), /CUSTOM_GOOGLE_CLIENT_ID is the same as GOOGLE_CLIENT_ID/));
});

test('Google Calendar: all three keys, a readable private key, a service account email', () => {
  const ok = { GOOGLE_CALENDAR_ID: 'facility@group.calendar.google.com', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'bot@my-project.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: pemOnOneLine() };
  assert.deepEqual(problems(ok), []);
  assert.ok(has(problems({ GOOGLE_CALENDAR_ID: ok.GOOGLE_CALENDAR_ID }), /^Google Calendar needs .*: GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY are missing, so it stays off/));
  assert.ok(has(problems({ ...ok, GOOGLE_PRIVATE_KEY: 'abc123' }), /^GOOGLE_PRIVATE_KEY should be the service account's whole private_key/));
  const broken = ok.GOOGLE_PRIVATE_KEY.replace(/\\n[A-Za-z0-9+/]{20}/, '\\n'); // part of the key lost while copying
  assert.ok(has(problems({ ...ok, GOOGLE_PRIVATE_KEY: broken }), /^GOOGLE_PRIVATE_KEY can't be read as a private key/));
  assert.ok(has(problems({ ...ok, GOOGLE_SERVICE_ACCOUNT_EMAIL: 'me@gmail.com' }), /should end in \.iam\.gserviceaccount\.com/));
});

test('payments, Turnstile and email values that cannot work', () => {
  assert.ok(has(problems({ HITPAY_API_KEY: 'k', HITPAY_SANDBOX: 'yes' }), /^HITPAY_SANDBOX must be true or false/));
  assert.ok(has(problems({ HITPAY_WEBHOOK_SALT: 'salt' }), /HITPAY_WEBHOOK_SALT does nothing without HITPAY_API_KEY/));
  assert.ok(has(problems({ TURNSTILE_SITE_KEY: '0x4AAAAAAAabcdefghijk', TURNSTILE_SECRET_KEY: '0x4AAAAAAAabcdefghijk' }), /TURNSTILE_SECRET_KEY is the same as the site key/));
  assert.ok(has(problems({ TURNSTILE_SITE_KEY: '0x4AAAAAAAabcdefghijk' }), /^Cloudflare Turnstile needs .*TURNSTILE_SECRET_KEY is missing/));
  assert.deepEqual(problems({ TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' }), [], 'Cloudflare test keys');
  assert.ok(has(problems({ RESEND_API_KEY: 'abc' }), /^RESEND_API_KEY should start with re_/));
  assert.ok(has(problems({ RESEND_API_KEY: 're_123' }), /Email through Resend needs EMAIL_FROM/));
  assert.ok(has(problems({ EMAIL_HOST: 'smtp://smtp.gmail.com:587', EMAIL_USER: 'u', EMAIL_PASS: 'p' }), /^EMAIL_HOST should be only the mail server's name/));
  assert.ok(has(problems({ EMAIL_HOST: 'smtp.gmail.com' }), /^Email by SMTP needs .*EMAIL_USER and EMAIL_PASS are missing, so no email is sent/));
  assert.ok(has(problems({ EMAIL_PORT: 'abc' }), /^EMAIL_PORT must be a port number/));
  assert.ok(has(problems({ EMAIL_FROM: 'bookings' }), /^EMAIL_FROM should be an email address/));
  assert.deepEqual(problems({ EMAIL_FROM: "MAKI's PickleBall <bookings@example.com>", EMAIL_HOST: 'smtp.gmail.com', EMAIL_PORT: '587', EMAIL_USER: 'u', EMAIL_PASS: 'p' }), []);
});

test('server settings: the example JWT_SECRET, a short one, addresses without https://', () => {
  assert.ok(has(problems({ JWT_SECRET: 'replace-with-a-long-random-secret' }), /^JWT_SECRET is still the example value/));
  assert.ok(has(problems({ JWT_SECRET: 'abc123' }), /^JWT_SECRET is short/));
  assert.deepEqual(problems({ JWT_SECRET: crypto.randomBytes(32).toString('hex') }), []);
  assert.ok(has(problems({ CLIENT_URL: 'localhost:5000' }), /^CLIENT_URL should start with https:\/\/ or http:\/\//));
  assert.ok(has(problems({ CORS_ORIGINS: 'https://ok.example.com, not a url' }), /^CORS_ORIGINS should be a full web address/));
  assert.ok(has(problems({ MONGO_URI: 'localhost:27017/db' }), /^MONGO_URI should start with mongodb:\/\//));
  assert.ok(has(problems({ NODE_ENV: 'live' }), /^NODE_ENV should be production/));
});

test('BACKUP_DIR: never inside the frontend folder, which anyone can download from', () => {
  assert.ok(has(problems({ BACKUP_DIR: '../frontend/backups' }), /^BACKUP_DIR is inside the frontend folder/));
  assert.deepEqual(problems({ BACKUP_DIR: '../private-backups' }), []);
  assert.deepEqual(problems({ BACKUP_DIR: '../frontend-backups' }), [], 'a folder that only starts with the same name is fine');
  assert.equal(E.unusedKeys({ BACKUP_DIR: 'x' }).length, 0);
});

test('keys the app does not read are listed, with a note for retired ones', () => {
  assert.deepEqual(E.unusedKeys({ GOOGLE_CLIENT_ID: ID, PAYMONGO_SECRET_KEY: '', SEMAPHORE_API_KEY: '', SEMAPHORE_SENDER_NAME: '', MY_OLD_KEY: 'x' }), [
    { key: 'MY_OLD_KEY', note: '' },
    { key: 'PAYMONGO_SECRET_KEY', note: 'PayMongo was replaced by HitPay' },
    { key: 'SEMAPHORE_API_KEY', note: 'SMS was removed' },
    { key: 'SEMAPHORE_SENDER_NAME', note: 'SMS was removed' },
  ]);
});

test('SMS is gone: its keys are not checked, watched or counted as a service', () => {
  assert.equal(E.KEYS.SEMAPHORE_API_KEY, undefined);
  assert.equal(E.WATCHED.some((k) => k.startsWith('SEMAPHORE_')), false);
  assert.equal(E.SERVICES.includes('sms'), false);
  assert.deepEqual(problems({ SEMAPHORE_SENDER_NAME: 'MAKISPICKLEBALL' }), [], 'an old SMS value is no longer a problem, only unused');
});

test('changes between two starts: services set up or not, keys added, changed or removed', () => {
  const before = {
    services: { googleSignIn: true, googleCalendar: false, hitpay: true },
    fingerprints: { GOOGLE_CLIENT_ID: 'aa', GOOGLE_PRIVATE_KEY: '', HITPAY_API_KEY: 'hh', EMAIL_PASS: 'pp' },
  };
  const after = {
    services: { googleSignIn: true, googleCalendar: true, hitpay: false },
    fingerprints: { GOOGLE_CLIENT_ID: 'bb', GOOGLE_PRIVATE_KEY: 'kk', HITPAY_API_KEY: '', EMAIL_PASS: 'pp', RESEND_API_KEY: 'rr' },
  };
  assert.deepEqual(E.describeChanges(before, after), [
    'Google Calendar is now set up',
    'HitPay is no longer set up',
    'GOOGLE_CLIENT_ID changed',
    'GOOGLE_PRIVATE_KEY added',
    'HITPAY_API_KEY removed',
  ], 'RESEND_API_KEY had no fingerprint before (a newly watched key), so it is not reported');
});

test('fingerprints tell a change apart without keeping the value', async () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const a = await E.fingerprint(salt, 'secret-value-1');
  assert.equal(a.length, 32);
  assert.equal(a.includes('secret'), false);
  assert.equal(await E.fingerprint(salt, 'secret-value-1'), a, 'same value, same fingerprint');
  assert.notEqual(await E.fingerprint(salt, 'secret-value-2'), a);
  assert.notEqual(await E.fingerprint(crypto.randomBytes(16).toString('hex'), 'secret-value-1'), a, 'another salt, another fingerprint');
  assert.equal(await E.fingerprint(salt, ''), '');
});

test('the create-admin script keys are known but their changes are not reported', () => {
  assert.equal(E.WATCHED.includes('ADMIN_PASSWORD'), false);
  assert.equal(E.unusedKeys({ ADMIN_PASSWORD: 'x' }).length, 0);
});
