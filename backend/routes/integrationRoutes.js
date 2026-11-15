/**
 * Admin side of the third-party integrations. Mounted inside adminRoutes, so every route
 * already requires a signed-in staff/admin account and writes are audit-logged.
 */
const express = require('express');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Settings = require('../models/Settings');
const { authorize } = require('../middleware/auth');
const handleError = require('../utils/handleError');
const U = require('../utils/bookingUtils');
const { status, isActive, NAMES, LABELS, forgetSwitches } = require('../utils/integrations');
const { syncBookingToCalendar } = require('../utils/integrations/google');
const hitpay = require('../utils/integrations/hitpay');
const { getForecast, forecastLocation } = require('../utils/integrations/weather');
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
const askText = (changes) => { // "Turn off HitPay and turn on SMS (Semaphore)"
  const s = sentence(Object.entries(changes).map(([n, on]) => `turn ${on ? 'on' : 'off'} ${LABELS[n]}`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const doneText = (changes) => Object.entries(changes).map(([n, on]) => `${LABELS[n]} ${on ? 'on' : 'off'}`).join(', '); // "HitPay off, SMS (Semaphore) on"

/**
 * Step 1: check the admin's PIN, keep the change, and send a one-time code to the admin.
 * body: { switches: { hitpay: false, ... }, pin }  ->  { challengeId, sentTo, expiresAt, resendIn, ... }
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

/** Open-Meteo forecast for the facility location set under Opening hours. */
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

/** HitPay: create (or reuse) a payment link for a booking and tell the customer. */
router.post('/bookings/:bookingId/hitpay-link', authorize('payments'), async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return bad(res, 'Booking not found', 404);
    if (!(await isActive('hitpay'))) return bad(res, 'HitPay is not set up or is turned off');
    await hitpay.ensurePaymentLink(booking, { by: req.user._id, renew: req.body.renew === true });
    await U.notify(booking.user, `Pay for booking ${booking.referenceNumber} online (GCash, QR Ph, card and more): open the booking from My Bookings and tap "Pay online now".`);
    res.json({ success: true, hitpay: booking.hitpay });
  } catch (err) { fail(res, err); }
});

/** HitPay: ask HitPay whether the link was paid, and record it if so. */
router.post('/bookings/:bookingId/hitpay-check', authorize('payments'), async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return bad(res, 'Booking not found', 404);
    const r = await hitpay.settleBooking(booking, { by: req.user._id });
    res.json({ success: true, paid: r.paid, alreadyPaid: Boolean(r.alreadyPaid), message: r.message || '', paymentStatus: r.booking.paymentStatus });
  } catch (err) { fail(res, err); }
});

module.exports = router;
