/**
 * Tests for the Google Sign-In client IDs (run: npm test).
 * No database and no calls to Google: the token check itself is replaced by a stand-in that records which
 * client ID it was asked to check against.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

mongoose.set('bufferCommands', false); // no database here: the on/off switches fall back to "on"

const { OAuth2Client } = require('google-auth-library');
const { googleClientIds, configured } = require('../utils/integrations');
const { verifyGoogleIdToken } = require('../utils/integrations/google');

const STAFF = 'staff-123.apps.googleusercontent.com';
const CUSTOMER = 'customer-456.apps.googleusercontent.com';

/** Runs fn with these environment values (null = not set), then puts everything back. */
async function withEnv(values, fn) {
  const before = {};
  for (const [k, v] of Object.entries(values)) {
    before[k] = process.env[k];
    if (v === null) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

/** Replaces Google's token check (and the "no database" log line) while fn runs. */
async function withFakeGoogle(check, fn) {
  const real = OAuth2Client.prototype.verifyIdToken;
  const log = console.error;
  OAuth2Client.prototype.verifyIdToken = check;
  console.error = () => {};
  try { return await fn(); } finally {
    OAuth2Client.prototype.verifyIdToken = real;
    console.error = log;
  }
}

test('customers use CUSTOM_GOOGLE_CLIENT_ID, staff keep GOOGLE_CLIENT_ID', () => withEnv({ GOOGLE_CLIENT_ID: STAFF, CUSTOM_GOOGLE_CLIENT_ID: CUSTOMER }, () => {
  assert.deepEqual(googleClientIds(), { staff: STAFF, customer: CUSTOMER });
  assert.equal(configured.googleSignIn(), true);
}));

test('without CUSTOM_GOOGLE_CLIENT_ID, customers share the staff client (as before)', () => withEnv({ GOOGLE_CLIENT_ID: STAFF, CUSTOM_GOOGLE_CLIENT_ID: null }, () => {
  assert.deepEqual(googleClientIds(), { staff: STAFF, customer: STAFF });
}));

test('only CUSTOM_GOOGLE_CLIENT_ID: customers get Google sign-in, the admin page does not', () => withEnv({ GOOGLE_CLIENT_ID: '', CUSTOM_GOOGLE_CLIENT_ID: CUSTOMER }, () => {
  assert.deepEqual(googleClientIds(), { staff: '', customer: CUSTOMER });
  assert.equal(configured.googleSignIn(), true);
}));

test('neither set (blank or spaces): Google Sign-In is not set up', () => withEnv({ GOOGLE_CLIENT_ID: null, CUSTOM_GOOGLE_CLIENT_ID: '   ' }, () => {
  assert.deepEqual(googleClientIds(), { staff: '', customer: '' });
  assert.equal(configured.googleSignIn(), false);
}));

test('each sign-in page checks the token against its own client ID', async () => {
  const asked = [];
  await withFakeGoogle(async function ({ audience }) {
    asked.push(audience);
    return { getPayload: () => ({ email: 'Pat.Player@Example.com', email_verified: true, given_name: 'Pat', family_name: 'Player' }) };
  }, async () => {
    await withEnv({ GOOGLE_CLIENT_ID: STAFF, CUSTOM_GOOGLE_CLIENT_ID: CUSTOMER }, async () => {
      await verifyGoogleIdToken('token-from-the-admin-page', 'staff');
      const who = await verifyGoogleIdToken('token-from-a-customer-page', 'customer');
      assert.deepEqual(asked, [STAFF, CUSTOMER]);
      assert.equal(who.email, 'pat.player@example.com');
      assert.equal(who.firstName, 'Pat');
      assert.equal(who.lastName, 'Player');
    });
    await withEnv({ GOOGLE_CLIENT_ID: STAFF, CUSTOM_GOOGLE_CLIENT_ID: null }, async () => {
      await verifyGoogleIdToken('token-from-a-customer-page', 'customer');
      assert.equal(asked[asked.length - 1], STAFF, 'no customer client: the shared one');
    });
    await withEnv({ GOOGLE_CLIENT_ID: '', CUSTOM_GOOGLE_CLIENT_ID: CUSTOMER }, async () => {
      await assert.rejects(verifyGoogleIdToken('token', 'staff'), /not set up for this page/);
    });
  });
});

test('a token Google does not accept for that client ID is refused', async () => {
  await withFakeGoogle(async () => { throw new Error('Wrong recipient, payload audience != requiredAudience'); }, () =>
    withEnv({ GOOGLE_CLIENT_ID: STAFF, CUSTOM_GOOGLE_CLIENT_ID: CUSTOMER }, () =>
      assert.rejects(verifyGoogleIdToken('a-token-made-for-the-staff-client', 'customer'),
        (err) => err.status === 401 && /could not be verified/.test(err.message))));
});

test('an unverified Google email is refused', async () => {
  await withFakeGoogle(async () => ({ getPayload: () => ({ email: 'someone@example.com', email_verified: false }) }), () =>
    withEnv({ GOOGLE_CLIENT_ID: STAFF, CUSTOM_GOOGLE_CLIENT_ID: CUSTOMER }, () =>
      assert.rejects(verifyGoogleIdToken('token', 'customer'), /not verified/)));
});
