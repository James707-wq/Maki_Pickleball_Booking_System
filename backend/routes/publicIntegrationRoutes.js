/**
 * Integration endpoints that must work without a signed-in user:
 *   GET  /api/integrations/config   public keys the admin login page needs (never secrets)
 *   POST /api/webhooks/hitpay       HitPay calls this when a payment link is paid
 * Mounted at /api BEFORE the routers that require a login.
 */
const express = require('express');
const Booking = require('../models/Booking');
const { publicConfig, isActive } = require('../utils/integrations');
const Settings = require('../models/Settings');
const { getForecast, forecastLocation } = require('../utils/integrations/weather');
const hitpay = require('../utils/integrations/hitpay');

const router = express.Router();

router.get('/integrations/config', async (req, res) => {
  try {
    res.json({ success: true, ...(await publicConfig()) });
  } catch (err) {
    res.json({ success: true, googleClientId: '', turnstileSiteKey: '' });
  }
});

/** Facility location for the customer map (only when the map is switched on). */
router.get('/facility', async (req, res) => {
  try {
    const s = await Settings.get();
    const pinned = s.facilityLat != null && s.facilityLng != null;
    res.json({
      success: true,
      map: (await isActive('maps')) && pinned,
      location: pinned ? { lat: s.facilityLat, lng: s.facilityLng, address: s.facilityAddress } : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load the facility location' });
  }
});

/** Forecast for one day, for customers choosing a date. GET /api/weather?date=YYYY-MM-DD */
router.get('/weather', async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, message: 'Pick a date' });
    if (!(await isActive('weather'))) return res.json({ success: true, forecast: null, days: [] });
    const loc = forecastLocation(await Settings.get());
    const w = await getForecast(loc.lat, loc.lng);
    // no date: the next 4 days (customer dashboard)
    if (!date) return res.json({ success: true, days: w.daily, place: loc.label, approximate: loc.approximate });
    const day = w.daily.find((d) => d.date === date) || null;
    const hours = w.hourly.filter((h) => h.time.slice(0, 10) === date);
    res.json({ success: true, forecast: day ? { ...day, hours, place: loc.label, approximate: loc.approximate } : null });
  } catch (err) {
    res.json({ success: true, forecast: null }); // weather is a nice-to-have: never break the booking page
  }
});

/**
 * HitPay webhook event (HitPay dashboard -> Developers -> Webhook Endpoints, event payment_request.completed).
 * Signed with Hitpay-Signature; the body is a payment request object.
 */
router.post('/webhooks/hitpay', async (req, res) => {
  if (!hitpay.verifyWebhook(req.rawBody, req.get('Hitpay-Signature'))) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }
  try {
    const body = req.body || {};
    const object = String(req.get('Hitpay-Event-Object') || 'payment_request');
    const requestId = body.payment_request_id || (object === 'payment_request' ? body.id : null);
    const booking = requestId
      ? await Booking.findOne({ $or: [{ 'hitpay.requestId': requestId }, { 'hitpay.previousRequestIds': requestId }] })
      : null;
    if (booking && booking.hitpay.requestId !== requestId) {
      // paid on a link that was replaced (e.g. after a fee change): staff need to sort it out
      const { paid } = await hitpay.getRequestPayment(requestId);
      if (paid) {
        const U = require('../utils/bookingUtils');
        await U.notifyStaff(`A replaced HitPay payment link for booking ${booking.referenceNumber} was paid. Check HitPay and record the payment by hand.`);
      }
    } else if (booking) {
      // don't trust the event body: settleBooking asks HitPay for the link's real status
      await hitpay.settleBooking(booking);
    }
    res.json({ success: true }); // always 200 for valid events (also ones about other things) so HitPay stops retrying
  } catch (err) {
    console.error('HitPay webhook failed:', err.message);
    res.status(500).json({ success: false }); // HitPay retries later
  }
});

module.exports = router;
