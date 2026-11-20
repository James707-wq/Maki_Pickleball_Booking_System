/**
 * Tests for "Reset to defaults" on the admin Integrations page (run: npm test). No database needed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { NAMES, defaultSwitches, planReset } = require('../utils/integrations');

/** A status() answer with every switch on (or off). */
const allSwitches = (on) => Object.fromEntries(NAMES.map((n) => [n, { configured: true, switchedOn: on, active: on }]));

test('every integration switch defaults to on (models/Settings.js)', () => {
  assert.deepEqual(defaultSwitches(), Object.fromEntries(NAMES.map((n) => [n, true])));
});

test('a reset turns back on only the switches that are off', () => {
  const now = allSwitches(true);
  now.googleSignIn.switchedOn = false;
  now.email.switchedOn = false;
  assert.deepEqual(planReset(now), { switches: { googleSignIn: true, email: true }, removeWebhook: false });
});

test('a service that is not set up is still switched back on (its keys decide whether it runs)', () => {
  const now = allSwitches(true);
  now.googleCalendar = { configured: false, switchedOn: false, active: false };
  assert.deepEqual(planReset(now).switches, { googleCalendar: true });
});

test('nothing to reset when every switch is already on', () => {
  assert.deepEqual(planReset(allSwitches(true)), { switches: {}, removeWebhook: false });
});

test('everything off: every switch comes back', () => {
  assert.deepEqual(Object.keys(planReset(allSwitches(false)).switches).sort(), [...NAMES].sort());
});

test('the custom API is removed only when asked, and only when it is set up', () => {
  assert.equal(planReset(allSwitches(true), { webhookSet: true }).removeWebhook, false);
  assert.equal(planReset(allSwitches(true), { webhookSet: true, alsoWebhook: true }).removeWebhook, true);
  assert.equal(planReset(allSwitches(true), { webhookSet: false, alsoWebhook: true }).removeWebhook, false);
});
