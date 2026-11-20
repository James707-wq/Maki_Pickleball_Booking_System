/**
 * Admin side of the third-party integrations. Mounted inside adminRoutes, so every route
 * already requires a signed-in staff/admin account and writes are audit-logged.
 */
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Settings = require('../models/Settings');
const { authorize } = require('../middleware/auth');
const handleError = require('../utils/handleError');
const U = require('../utils/bookingUtils');
const { status, isActive, NAMES, LABELS, forgetSwitches, planReset } = require('../utils/integrations');
const { syncBookingToCalendar } = require('../utils/integrations/google');
const { getForecast, forecastLocation } = require('../utils/integrations/weather');
const webhook = require('../utils/integrations/webhook');
const { seal } = require('../utils/secretBox');
const twoStep = require('../utils/twoStep');

const router = express.Router();
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const fail = (res, err) => (err.status ? bad(res, err.message, err.status) : handleError(res, err));

router.param('bookingId', (req, res, next, id) => (mongoose.isValidObjectId(id) ? next() : bad(res, 'Not found', 404)));

/** Which integrations are switched on (no secrets), plus what the two-step check needs. */
router.get('/integrations', authorize('settings'), async (req, res) => {
  try {
    const s = await Settings.get();
    res.json({
      success: true,
      integrations: await status(),
      facility: { lat: s.facilityLat, lng: s.facilityLng, address: s.facilityAddress },
      security: twoStep.summary(req.user),
      webhookFailed: await webhook.failedSince(new Date(Date.now() - 24 * 3600e3)), // custom API events that gave up today
      env: require('../utils/envCheck').view(), // backend/.env: values that can't work, edits waiting for a restart (names only)
    });
  } catch (err) { handleError(res, err); }
});

/* -------- Turning integrations on or off: security PIN, then a one-time code (utils/twoStep.js) -------- */

/** Only the switches in `body.switches` that would really change: { changes } or { error, code }. */
async function wantedChanges(body) {
  const given = body && typeof body.switches === 'object' && body.switches ? body.switches : {};
  const names = Object.keys(given).filter((n) => NAMES.includes(n));
  if (!names.length) return { error: 'Nothing to change' };
  if (names.some((n) => typeof given[n] !== 'boolean')) return { error: 'Each switch must be true or false' };
  const now = await status();
  const changes = Object.fromEntries(names.filter((n) => now[n].switchedOn !== given[n]).map((n) => [n, given[n]]));
  if (!Object.keys(changes).length) return { error: 'Already set that way. Reload the page to see the latest settings.', code: 409 };
  return { changes };
}
const sentence = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]);
const askText = (changes) => { // "Turn off Weather and turn on Email"
  const s = sentence(Object.entries(changes).map(([n, on]) => `turn ${on ? 'on' : 'off'} ${LABELS[n]}`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const doneText = (changes) => Object.entries(changes).map(([n, on]) => `${LABELS[n]} ${on ? 'on' : 'off'}`).join(', '); // "Weather off, Email on"

/**
 * Step 1: check the admin's PIN, keep the change, and send a one-time code to the admin.
 * body: { switches: { weather: false, ... }, pin }  ->  { challengeId, sentTo, expiresAt, resendIn, ... }
 */
router.post('/integrations/verify', authorize('settings'), async (req, res) => {
  try {
    const w = await wantedChanges(req.body);
    if (w.error) return bad(res, w.error, w.code);
    const pin = await twoStep.checkPin(req, req.body.pin);
    if (!pin.ok) return twoStep.reply(res, pin);
    const r = await twoStep.startChallenge(req, 'integrations', { switches: w.changes }, askText(w.changes));
    if (!r.ok) return twoStep.reply(res, r);
    res.locals.auditDetail = `${doneText(w.changes)}; code sent to ${r.sentTo.map((s) => s.label).join(', ')}`;
    res.json({ success: true, what: askText(w.changes), ...twoStep.challengeView(r.challenge, r.sentTo) });
  } catch (err) { handleError(res, err); }
});

/** Send a new code for a change still waiting for one.   body: { challengeId } */
router.post('/integrations/verify/resend', authorize('settings'), async (req, res) => {
  try {
    const r = await twoStep.resendChallenge(req, 'integrations', req.body.challengeId);
    if (!r.ok) return twoStep.reply(res, r);
    res.json({ success: true, ...twoStep.challengeView(r.challenge, r.sentTo) });
  } catch (err) { handleError(res, err); }
});

/**
 * Step 2: the one-time code. Applies the change saved in step 1 (never switches sent with this request)
 * and alerts every admin.   body: { challengeId, otp }
 */
router.put('/integrations', authorize('settings'), async (req, res) => {
  try {
    if (!req.body.challengeId) {
      return bad(res, 'Turning integrations on or off needs your security PIN and a one-time code. Reload the page and try again.', 428);
    }
    const r = await twoStep.useChallenge(req, 'integrations', req.body.challengeId, req.body.otp);
    if (!r.ok) return twoStep.reply(res, r);

    const saved = (r.challenge.payload && r.challenge.payload.switches) || {};
    const changes = Object.fromEntries(Object.entries(saved).filter(([n, on]) => NAMES.includes(n) && typeof on === 'boolean'));
    if (!Object.keys(changes).length) return bad(res, 'Nothing to change');
    await Settings.get(); // creates the settings document the first time
    // only the switches in this change are written, so two admins changing different ones can't undo each other
    await Settings.updateOne({ key: 'main' }, { $set: Object.fromEntries(Object.entries(changes).map(([n, on]) => [`integrationSwitches.${n}`, on])) });
    forgetSwitches();

    res.locals.auditDetail = `${doneText(changes)} (confirmed with PIN and one-time code)`;
    const alertEmailed = twoStep.alertAdmins(req, doneText(changes));
    res.json({ success: true, changed: changes, alertEmailed, integrations: await status() });
  } catch (err) { handleError(res, err); }
});

/** Open-Meteo forecast for the facility location pinned under Location. */
router.get('/integrations/weather', async (req, res) => {
  try {
    if (!(await isActive('weather'))) return res.json({ success: true, weather: null, off: true });
    const loc = forecastLocation(await Settings.get());
    res.json({
      success: true,
      weather: await getForecast(loc.lat, loc.lng),
      location: { label: loc.label, approximate: loc.approximate },
      facility: { address: loc.approximate ? '' : loc.label },
    });
  } catch (err) { fail(res, err); }
});

/**
 * Address search for pinning the facility (OpenStreetMap Nominatim: free, no key; light use only).
 * GET /api/admin/integrations/geocode?q=Rizal+Park+Manila   or   ?lat=..&lng=.. for the address of a point.
 */
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const nominatimHeaders = () => ({
  // Nominatim's usage policy asks for an identifying User-Agent
  'User-Agent': `MAKIs-PickleBall-Court-Admin/1.0 (${process.env.CLIENT_URL || 'localhost'})`,
  'Accept-Language': 'en',
});
router.get('/integrations/geocode', authorize('settings'), async (req, res) => {
  try {
    if (req.query.lat !== undefined) {
      const lat = Number(req.query.lat); const lng = Number(req.query.lng);
      if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return bad(res, 'That map location is not valid');
      const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`, { headers: nominatimHeaders(), signal: AbortSignal.timeout(10000) });
      const d = r.ok ? await r.json() : {};
      return res.json({ success: true, address: d.display_name || '' });
    }
    const q = String(req.query.q || '').trim().slice(0, 160);
    if (q.length < 3) return bad(res, 'Type at least 3 letters of the address');
    const r = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=5&countrycodes=ph&q=${encodeURIComponent(q)}`, { headers: nominatimHeaders(), signal: AbortSignal.timeout(10000) });
    if (!r.ok) return bad(res, 'Address search is busy right now. Click the map instead.', 502);
    const list = await r.json();
    res.json({ success: true, results: list.map((x) => ({ label: x.display_name, lat: Number(x.lat), lng: Number(x.lon) })) });
  } catch (err) {
    bad(res, 'Address search is not available right now. Click the map instead.', 502);
  }
});

/** Push every upcoming confirmed booking to Google Calendar (and clean up cancelled ones). */
router.post('/integrations/calendar/sync', authorize('settings'), async (req, res) => {
  try {
    if (!(await isActive('googleCalendar'))) return bad(res, 'Google Calendar is not set up or is turned off');
    const from = U.manilaMidnight(U.todayStr());
    const list = await Booking.find({
      date: { $gte: from },
      $or: [{ status: { $in: ['confirmed', 'completed'] } }, { calendarEventId: { $exists: true } }],
    }).select('_id').limit(500);
    const counts = {};
    for (const b of list) {
      const r = await syncBookingToCalendar(b._id);
      counts[r] = (counts[r] || 0) + 1;
    }
    res.json({ success: true, total: list.length, counts });
  } catch (err) { fail(res, err); }
});

/* -------- Custom API (webhook): the facility's own system gets signed booking events -------- */

/** The custom API's settings as they are before it is set up (used by Remove and by Reset to defaults). */
const WEBHOOK_CLEARED = {
  'webhook.url': '', 'webhook.secret': '', 'webhook.secretHint': '', 'webhook.secretSetAt': null, 'webhook.events': [], 'webhook.includeContact': false,
};

/** Saved settings, the events that can be chosen and the latest deliveries (never the secret). */
router.get('/integrations/webhook', authorize('settings'), async (req, res) => {
  try {
    res.json({
      success: true,
      webhook: await webhook.adminView(),
      events: Object.entries(webhook.EVENTS).map(([type, label]) => ({ type, label })),
      retryMinutes: webhook.RETRY_MINUTES,
      deliveries: await webhook.recentDeliveries(20),
      security: twoStep.summary(req.user),
    });
  } catch (err) { handleError(res, err); }
});

/** The change an admin asked for, checked: { change, what } or { error, code }. A secret is only kept sealed. */
async function webhookChange(body) {
  const b = body || {};
  const now = await webhook.adminView();
  if (b.remove === true) {
    if (!now.url && !now.secretSet) return { error: 'There is nothing to remove', code: 409 };
    return { change: { remove: true }, what: 'Remove the custom API (webhook)' };
  }
  const url = String(b.url || '').trim();
  const problem = webhook.addressProblem(url);
  if (problem) return { error: problem };
  const events = [...new Set(Array.isArray(b.events) ? b.events : [])].filter((e) => webhook.EVENTS[e]);
  if (!events.length) return { error: 'Choose at least one event to send' };
  const includeContact = b.includeContact === true;
  const mode = ['keep', 'generate', 'custom'].includes(b.secretMode) ? b.secretMode : 'generate';
  if (mode === 'keep' && !now.secretReadable) return { error: 'There is no saved secret to keep. Make a new one or enter your own.' };
  let sealed = '';
  let hint = '';
  if (mode === 'custom') {
    const own = String(b.secret || '');
    if (own.length < 16 || own.length > 200 || /\s/.test(own)) return { error: 'Your own secret must be 16 to 200 characters, without spaces' };
    sealed = seal(own); // sealed while it waits for the one-time code, too
    hint = own.slice(-4);
  }
  const same = url === now.url && includeContact === now.includeContact && mode === 'keep'
    && events.length === now.events.length && events.every((e) => now.events.includes(e));
  if (same) return { error: 'Nothing changed', code: 409 };
  const kinds = events.length === Object.keys(webhook.EVENTS).length ? 'all booking events' : `${events.length} kind${events.length === 1 ? '' : 's'} of booking event`;
  const what = `${now.url ? 'Change the custom API' : 'Set up the custom API'}: send ${kinds} to ${new URL(url).host}${includeContact ? ', with customer contact details' : ''}`;
  return { change: { url, events, includeContact, secretMode: mode, sealed, hint }, what };
}

/**
 * Step 1: check the admin's PIN, keep the change, and send a one-time code (like the on/off switches).
 * body: { url, events, includeContact, secretMode: 'keep'|'generate'|'custom', secret, pin }  or  { remove: true, pin }
 */
router.post('/integrations/webhook/verify', authorize('settings'), async (req, res) => {
  try {
    const w = await webhookChange(req.body);
    if (w.error) return bad(res, w.error, w.code);
    const pin = await twoStep.checkPin(req, req.body.pin);
    if (!pin.ok) return twoStep.reply(res, pin);
    const r = await twoStep.startChallenge(req, 'webhook', { webhook: w.change }, w.what);
    if (!r.ok) return twoStep.reply(res, r);
    res.locals.auditDetail = `${w.what}; code sent to ${r.sentTo.map((s) => s.label).join(', ')}`;
    res.json({ success: true, what: w.what, ...twoStep.challengeView(r.challenge, r.sentTo) });
  } catch (err) { handleError(res, err); }
});

/** A new code for a custom API change still waiting for one.   body: { challengeId } */
router.post('/integrations/webhook/verify/resend', authorize('settings'), async (req, res) => {
  try {
    const r = await twoStep.resendChallenge(req, 'webhook', req.body.challengeId);
    if (!r.ok) return twoStep.reply(res, r);
    res.json({ success: true, ...twoStep.challengeView(r.challenge, r.sentTo) });
  } catch (err) { handleError(res, err); }
});

/**
 * Step 2: the one-time code. Saves the change kept in step 1 (never settings sent with this request) and
 * alerts every admin. A secret made here is in this answer only: it is never shown again.   body: { challengeId, otp }
 */
router.put('/integrations/webhook', authorize('settings'), async (req, res) => {
  try {
    if (!req.body.challengeId) {
      return bad(res, 'Changing the custom API needs your security PIN and a one-time code. Reload the page and try again.', 428);
    }
    const r = await twoStep.useChallenge(req, 'webhook', req.body.challengeId, req.body.otp);
    if (!r.ok) return twoStep.reply(res, r);

    const c = (r.challenge.payload && r.challenge.payload.webhook) || {};
    let secret = '';
    let set;
    if (c.remove) {
      set = { ...WEBHOOK_CLEARED };
    } else {
      if (!c.url || !Array.isArray(c.events)) return bad(res, 'Nothing to change');
      set = { 'webhook.url': c.url, 'webhook.events': c.events, 'webhook.includeContact': Boolean(c.includeContact) };
      if (c.secretMode === 'generate') {
        secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
        Object.assign(set, { 'webhook.secret': seal(secret), 'webhook.secretHint': secret.slice(-4), 'webhook.secretSetAt': new Date() });
      } else if (c.secretMode === 'custom' && c.sealed) {
        Object.assign(set, { 'webhook.secret': c.sealed, 'webhook.secretHint': c.hint || '', 'webhook.secretSetAt': new Date() });
      }
    }
    await Settings.get(); // creates the settings document the first time
    await Settings.updateOne({ key: 'main' }, { $set: set });
    forgetSwitches();

    const what = r.challenge.what || 'Changed the custom API (webhook)';
    const secretNote = secret ? '; a new signing secret was made' : c.secretMode === 'custom' ? '; their own signing secret was saved' : '';
    res.locals.auditDetail = `${what}${secretNote} (confirmed with PIN and one-time code)`;
    const alertEmailed = twoStep.alertAdmins(req, `${what}${secretNote}`);
    res.json({ success: true, webhook: await webhook.adminView(), alertEmailed, ...(secret ? { secret } : {}) });
  } catch (err) { handleError(res, err); }
});

/** Sends a test event now with the saved address and secret (works while switched off too). */
const lastTest = new Map(); // admin id -> when they last sent a test
router.post('/integrations/webhook/test', authorize('settings'), async (req, res) => {
  try {
    const v = await webhook.adminView();
    if (!v.url || !v.secretReadable) return bad(res, 'Save an address and a secret first');
    const who = String(req.user._id);
    if (Date.now() - (lastTest.get(who) || 0) < 5000) return bad(res, 'Wait a few seconds between tests', 429);
    lastTest.set(who, Date.now());
    const d = await webhook.sendTest();
    res.locals.auditDetail = `Test to ${new URL(v.url).host}: ${d ? d.status : 'not sent'}${d && d.responseStatus ? ` (${d.responseStatus})` : ''}`;
    res.json({ success: true, delivery: d ? webhook.deliveryView(d) : null });
  } catch (err) { handleError(res, err); }
});

/** Sends a failed booking event once more, now. */
router.post('/integrations/webhook/deliveries/:deliveryId/retry', authorize('settings'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.deliveryId)) return bad(res, 'Not found', 404);
    const d = await webhook.retryDelivery(req.params.deliveryId);
    if (!d) return bad(res, 'Only failed events can be sent again. Reload to see the latest.', 409);
    res.locals.auditDetail = `${d.type}: ${d.status}${d.responseStatus ? ` (${d.responseStatus})` : ''}`;
    res.json({ success: true, delivery: webhook.deliveryView(d) });
  } catch (err) { handleError(res, err); }
});

/* -------- Reset to defaults: every switch back to its default position; the custom API only when asked -------- */

/** What a reset would change right now: { switches, removeWebhook, webhookSet }. */
async function resetPlan(alsoWebhook) {
  const [now, w] = await Promise.all([status(), webhook.adminView()]);
  const webhookSet = Boolean(w.url || w.secretSet);
  return { ...planReset(now, { webhookSet, alsoWebhook }), webhookSet };
}
/** "Reset integrations to defaults: turn on Google Sign-In and Email and remove the custom API (webhook)" */
function resetText(plan) {
  const named = (on) => Object.entries(plan.switches).filter(([, v]) => v === on).map(([n]) => LABELS[n]);
  const parts = [];
  if (named(true).length) parts.push(`turn on ${sentence(named(true))}`);
  if (named(false).length) parts.push(`turn off ${sentence(named(false))}`);
  if (plan.removeWebhook) parts.push('remove the custom API (webhook)');
  return `Reset integrations to defaults: ${sentence(parts)}`;
}
const resetEmpty = (plan) => !Object.keys(plan.switches).length && !plan.removeWebhook;

/** What a reset would change, for the admin console to show before it asks for the PIN. */
router.get('/integrations/reset', authorize('settings'), async (req, res) => {
  try {
    const plan = await resetPlan(false);
    res.json({ success: true, switches: plan.switches, webhookSet: plan.webhookSet, security: twoStep.summary(req.user) });
  } catch (err) { handleError(res, err); }
});

/** Step 1: check the PIN, keep the reset, send a one-time code.   body: { pin, webhook: true to also remove the custom API } */
router.post('/integrations/reset/verify', authorize('settings'), async (req, res) => {
  try {
    const plan = await resetPlan(Boolean(req.body && req.body.webhook === true));
    if (resetEmpty(plan)) return bad(res, 'Everything is already at the defaults', 409);
    const pin = await twoStep.checkPin(req, req.body.pin);
    if (!pin.ok) return twoStep.reply(res, pin);
    const what = resetText(plan);
    const r = await twoStep.startChallenge(req, 'integrations-reset', { reset: { switches: plan.switches, removeWebhook: plan.removeWebhook } }, what);
    if (!r.ok) return twoStep.reply(res, r);
    res.locals.auditDetail = `${what}; code sent to ${r.sentTo.map((s) => s.label).join(', ')}`;
    res.json({ success: true, what, ...twoStep.challengeView(r.challenge, r.sentTo) });
  } catch (err) { handleError(res, err); }
});

/** A new code for a reset still waiting for one.   body: { challengeId } */
router.post('/integrations/reset/verify/resend', authorize('settings'), async (req, res) => {
  try {
    const r = await twoStep.resendChallenge(req, 'integrations-reset', req.body.challengeId);
    if (!r.ok) return twoStep.reply(res, r);
    res.json({ success: true, ...twoStep.challengeView(r.challenge, r.sentTo) });
  } catch (err) { handleError(res, err); }
});

/**
 * Step 2: the one-time code. Applies exactly the reset shown in step 1 (a switch someone moved since then is left
 * alone) and alerts every admin.   body: { challengeId, otp }
 */
router.put('/integrations/reset', authorize('settings'), async (req, res) => {
  try {
    if (!req.body.challengeId) {
      return bad(res, 'Resetting integrations needs your security PIN and a one-time code. Reload the page and try again.', 428);
    }
    const r = await twoStep.useChallenge(req, 'integrations-reset', req.body.challengeId, req.body.otp);
    if (!r.ok) return twoStep.reply(res, r);

    const saved = (r.challenge.payload && r.challenge.payload.reset) || {};
    const changed = Object.fromEntries(Object.entries(saved.switches || {}).filter(([n, on]) => NAMES.includes(n) && typeof on === 'boolean'));
    const set = Object.fromEntries(Object.entries(changed).map(([n, on]) => [`integrationSwitches.${n}`, on]));
    if (saved.removeWebhook) Object.assign(set, WEBHOOK_CLEARED);
    if (!Object.keys(set).length) return bad(res, 'Nothing to change');
    await Settings.get(); // creates the settings document the first time
    await Settings.updateOne({ key: 'main' }, { $set: set });
    forgetSwitches();

    const what = r.challenge.what || 'Reset integrations to defaults';
    res.locals.auditDetail = `${what} (confirmed with PIN and one-time code)`;
    const alertEmailed = twoStep.alertAdmins(req, what);
    res.json({ success: true, changed, removedWebhook: Boolean(saved.removeWebhook), alertEmailed, integrations: await status() });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
