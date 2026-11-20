/**
 * Integration endpoints that must work without a signed-in user:
 *   GET  /api/integrations/config   public keys the admin login page needs (never secrets)
 * Mounted at /api BEFORE the routers that require a login.
 */
const express = require('express');
const { publicConfig, isActive } = require('../utils/integrations');
const Settings = require('../models/Settings');
const { getForecast, forecastLocation } = require('../utils/integrations/weather');
const { publicView } = require('../utils/policy');

const router = express.Router();

router.get('/integrations/config', async (req, res) => {
  try {
    res.json({ success: true, ...(await publicConfig()) });
  } catch (err) {
    res.json({ success: true, googleClientId: '', customerGoogleClientId: '', turnstileSiteKey: '' });
  }
});

/**
 * Where the facility is, for the customer "Find us" maps and the Location page.
 * map: show a map (switched on AND pinned). location: the pin, or null until an admin pins it.
 * address and hours are sent even without a pin.
 * rules: the booking rules, cancellation policy and payment settings (utils/policy.js), with readable lines.
 */
router.get('/facility', async (req, res) => {
  try {
    const s = await Settings.get();
    const pinned = s.facilityLat != null && s.facilityLng != null;
    res.json({
      success: true,
      map: (await isActive('maps')) && pinned,
      location: pinned ? { lat: s.facilityLat, lng: s.facilityLng, address: s.facilityAddress } : null,
      address: s.facilityAddress || '',
      hours: { open: s.openTime, close: s.closeTime },
      rules: publicView(s),
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

module.exports = router;
