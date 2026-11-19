/**
 * The API for other systems: /api/v1, called with an API token (admin -> Security -> API tokens) instead of a password.
 *   GET  /api/v1/me                                    the token itself: name, permissions, rate limit, expiry
 *   GET  /api/v1/courts                                courts:read
 *   GET  /api/v1/courts/:id/availability?date=         courts:read   (date: YYYY-MM-DD, default today)
 *   GET  /api/v1/bookings?from=&to=&status=&court=&page=&limit=
 *                                                      bookings:read (customers:read adds email and mobile)
 *   GET  /api/v1/bookings/:reference                   bookings:read
 *   POST /api/v1/check-ins   { code }                  checkins:write (code: a booking reference or the customer's QR code)
 * Every answer is JSON: { success: true, ... } or { success: false, code, message }. Each token has its own rate limit
 * (RateLimit headers on every answer). Bookings look the same as in the custom API's webhook events.
 */
const express = require('express');
const mongoose = require('mongoose');
const Court = require('../models/Court');
const Booking = require('../models/Booking');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const U = require('../utils/bookingUtils');
const webhook = require('../utils/integrations/webhook');
const { apiTokenAuth, requireScope, tokenRateLimit } = require('../middleware/apiToken');

const router = express.Router();
router.use(apiTokenAuth, tokenRateLimit);

const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message });
const oops = (res, err) => { console.error('API v1 failed:', err.message); fail(res, 500, 'SERVER_ERROR', 'Something went wrong on the server'); };
const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'];

const courtView = (c) => ({
  id: String(c._id), name: c.name, number: c.courtNumber || '', location: c.location || '', status: c.status, pricePerHour: c.pricePerHour,
  currency: 'PHP', openTime: c.openTime, closeTime: c.closeTime, slotMinutes: c.slotDurationMinutes, facilities: c.facilities || [],
});

/** The customers behind some bookings: name always, email and mobile only with customers:read. */
async function customersOf(bookings, withContact) {
  const ids = [...new Set(bookings.map((b) => String(b.user)))].filter((id) => mongoose.isValidObjectId(id));
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select(withContact ? 'firstName lastName email phone' : 'firstName lastName').lean() : [];
  return new Map(users.map((u) => [String(u._id), u]));
}
async function bookingsView(req, bookings) {
  const withContact = req.apiToken.scopes.includes('customers:read');
  const users = await customersOf(bookings, withContact);
  return bookings.map((b) => webhook.bookingData(b, users.get(String(b.user)) || null, withContact));
}

router.get('/me', (req, res) => {
  const t = req.apiToken;
  res.json({ success: true, token: { name: t.name, prefix: t.prefix, scopes: t.scopes, rateLimit: t.rateLimit, expiresAt: t.expiresAt } });
});

router.get('/courts', requireScope('courts:read'), async (req, res) => {
  try {
    res.json({ success: true, courts: (await Court.find().sort({ name: 1 })).map(courtView) });
  } catch (err) { oops(res, err); }
});

router.get('/courts/:id/availability', requireScope('courts:read'), async (req, res) => {
  try {
    const date = String(req.query.date || U.todayStr());
    if (!U.isDateStr(date)) return fail(res, 400, 'BAD_REQUEST', 'date must be YYYY-MM-DD');
    const court = mongoose.isValidObjectId(req.params.id) ? await Court.findById(req.params.id) : null;
    if (!court) return fail(res, 404, 'NOT_FOUND', 'No court with that id (see GET /api/v1/courts)');
    res.json({ success: true, court: courtView(court), date, slots: court.status === 'available' ? await U.daySlots(court, date) : [] });
  } catch (err) { oops(res, err); }
});

router.get('/bookings', requireScope('bookings:read'), async (req, res) => {
  try {
    const from = String(req.query.from || U.todayStr());
    const to = String(req.query.to || from);
    if (!U.isDateStr(from) || !U.isDateStr(to)) return fail(res, 400, 'BAD_REQUEST', 'from and to must be YYYY-MM-DD');
    if (to < from) return fail(res, 400, 'BAD_REQUEST', 'to must be the same day as from, or later');
    if ((U.manilaMidnight(to) - U.manilaMidnight(from)) / 864e5 > 62) return fail(res, 400, 'BAD_REQUEST', 'Ask for at most 62 days at a time');
    const filter = { date: { $gte: U.manilaMidnight(from), $lte: U.manilaMidnight(to) } };
    if (req.query.status) {
      const wanted = String(req.query.status).split(',').map((s) => s.trim());
      if (wanted.some((s) => !STATUSES.includes(s))) return fail(res, 400, 'BAD_REQUEST', `status can be ${STATUSES.join(', ')} (several with commas)`);
      filter.status = { $in: wanted };
    }
    if (req.query.court) {
      if (!mongoose.isValidObjectId(req.query.court)) return fail(res, 400, 'BAD_REQUEST', 'court must be a court id (see GET /api/v1/courts)');
      filter.court = req.query.court;
    }
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [total, list] = await Promise.all([
      Booking.countDocuments(filter),
      Booking.find(filter).sort({ date: 1, startTime: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.json({ success: true, from, to, page, pages: Math.max(1, Math.ceil(total / limit)), total, bookings: await bookingsView(req, list) });
  } catch (err) { oops(res, err); }
});

router.get('/bookings/:reference', requireScope('bookings:read'), async (req, res) => {
  try {
    const b = await Booking.findOne({ referenceNumber: String(req.params.reference).toUpperCase().slice(0, 40) }).lean();
    if (!b) return fail(res, 404, 'NOT_FOUND', 'No booking with that reference');
    res.json({ success: true, booking: (await bookingsView(req, [b]))[0] });
  } catch (err) { oops(res, err); }
});

/** Same rules as the desk: a confirmed booking, today, not checked in yet. */
router.post('/check-ins', requireScope('checkins:write'), async (req, res) => {
  try {
    const code = String((req.body && req.body.code) || '').trim();
    let booking = null;
    if (/^MKI1\./.test(code)) {
      const { isActive } = require('../utils/integrations');
      if (!(await isActive('qrCheckin'))) return fail(res, 409, 'QR_OFF', 'QR check-in is turned off under Integrations. Send the booking reference instead.');
      const id = require('../utils/integrations/qr').readCheckinCode(code);
      if (!id) return fail(res, 400, 'BAD_REQUEST', 'This QR code is not valid');
      booking = await Booking.findById(id);
    } else if (/^MKI-[A-Z0-9-]+$/i.test(code)) {
      booking = await Booking.findOne({ referenceNumber: code.toUpperCase().slice(0, 40) });
    } else {
      return fail(res, 400, 'BAD_REQUEST', 'Send { "code": "<booking reference MKI-... or the QR code>" }');
    }
    if (!booking) return fail(res, 404, 'NOT_FOUND', 'No booking for that code');
    if (!['confirmed', 'completed'].includes(booking.status)) return fail(res, 409, 'NOT_CONFIRMED', `This booking is ${booking.status}, not confirmed`);
    if (U.toDateStr(booking.date) !== U.todayStr()) return fail(res, 409, 'NOT_TODAY', `This booking is on ${U.toDateStr(booking.date)}, not today`);
    if (booking.checkedInAt) return fail(res, 409, 'ALREADY_CHECKED_IN', 'Already checked in');
    const at = new Date();
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, status: { $in: ['confirmed', 'completed'] }, checkedInAt: { $exists: false } },
      { $set: { checkedInAt: at } },
      { new: true }
    );
    if (!updated) return fail(res, 409, 'ALREADY_CHECKED_IN', 'Already checked in');
    webhook.queueChange(updated, 'booking.checked_in', { checkedInAt: [null, at] });
    AuditLog.create({
      actorName: `API token "${req.apiToken.name}"`, actorRole: 'api', action: 'Checked a customer in (API token)',
      method: req.method, path: req.originalUrl, ip: req.ip, statusCode: 200, entityId: String(updated._id),
      detail: `Booking ${updated.referenceNumber}, ${updated.courtName} ${updated.startTime}-${updated.endTime}`,
    }).catch((err) => console.error('Audit log failed:', err.message));
    res.json({ success: true, checkedInAt: at, booking: (await bookingsView(req, [updated.toObject()]))[0] });
  } catch (err) { oops(res, err); }
});

router.use((req, res) => fail(res, 404, 'NOT_FOUND', 'No such API endpoint. GET /api/v1/me shows what your token may do.'));

module.exports = router;
