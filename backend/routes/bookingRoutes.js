const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Court = require('../models/Court');
const Promotion = require('../models/Promotion');
const { protect } = require('../middleware/auth');
const U = require('../utils/bookingUtils');
const handleError = require('../utils/handleError');
const C = require('../utils/concurrency');

// txRouter: every write route below runs as a timestamped transaction (abort + restart on conflict)
const router = C.txRouter(express.Router());
router.use(protect);

const BOOKING_LIST_LIMIT = 100;

router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ success: false, message: 'Booking not found' });
  }
  next();
});

const generateReferenceNumber = () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `MKI-${stamp}-${rand}`;
};

/**
 * UF-116 Court Booking / UF-117 Details / UF-120 Reference / UF-121 Payment Status
 * POST /api/bookings   body: { courtId, date, startTime }
 * Every new booking starts as "pending" and is confirmed when an admin approves it (AF-116).
 */
router.get('/', async (req, res) => {
  try {
    const { scope = 'all', status } = req.query;
    if (!['all', 'upcoming', 'history'].includes(scope)) {
      return res.status(400).json({ success: false, message: 'Invalid booking scope' });
    }
    if (status && !['pending', 'confirmed', 'completed', 'cancelled', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid booking status' });
    }

    await U.autoCompleteBookings({ user: req.user._id });
    const filter = { user: req.user._id };

    if (status) {
      filter.status = status;
    } else if (scope === 'upcoming') {
      filter.status = { $in: ['pending', 'confirmed'] };
    } else if (scope === 'history') {
      filter.status = { $in: ['completed', 'cancelled', 'rejected'] };
    }

    let query = Booking.find(filter)
      .sort(scope === 'upcoming' ? { date: 1, startTime: 1 } : { date: -1, startTime: -1 })
      .populate('court', 'name location pricePerHour')
      .limit(BOOKING_LIST_LIMIT);
    let bookings = await query;

    if (!status && scope === 'upcoming') {
      bookings = bookings.filter((booking) => U.endInstant(booking) > new Date());
    }

    res.json({ success: true, bookings });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/reference/:referenceNumber', async (req, res) => {
  try {
    const referenceNumber = String(req.params.referenceNumber || '').trim().toUpperCase();
    if (!referenceNumber) {
      return res.status(400).json({ success: false, message: 'Enter a booking reference number' });
    }

    const booking = await Booking.findOne({
      user: req.user._id,
      referenceNumber,
    }).populate('court', 'name location pricePerHour');

    if (!booking) {
      return res.status(404).json({ success: false, message: 'No booking found for that reference number' });
    }
    res.json({ success: true, booking });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const human = await require('../utils/integrations/turnstile').verifyTurnstile(req.body.captchaToken, req.ip);
    if (!human.ok) return res.status(400).json({ success: false, message: human.message });
    const { courtId, date, startTime } = req.body;
    if (!courtId || !date || !startTime) {
      return res.status(400).json({ success: false, message: 'courtId, date and startTime are required' });
    }
    if (!mongoose.isValidObjectId(courtId)) {
      return res.status(400).json({ success: false, message: 'Invalid courtId' });
    }

    const court = await Court.findById(courtId);
    if (!court) return res.status(404).json({ success: false, message: 'Court not found' });

    const check = await U.validateSlot(court, date, startTime);
    if (!check.ok) return res.status(check.code).json({ success: false, message: check.message });

    // AF-127: optional promo code. Usage is claimed atomically so a limited promo can't be over-used.
    let totalFee = check.totalFee;
    let discount = 0;
    let promoCode = '';
    const rawCode = String(req.body.promoCode || '').trim().toUpperCase();
    let claimed = null;
    if (rawCode) {
      const promo = await Promotion.findOne({ code: rawCode });
      if (!promo) return res.status(400).json({ success: false, message: 'That promo code is not valid' });
      const problem = promo.problem();
      if (problem) return res.status(400).json({ success: false, message: problem });
      claimed = await Promotion.findOneAndUpdate(
        { _id: promo._id, active: true, $or: [{ usageLimit: 0 }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
        { $inc: { usedCount: 1 } }, { new: true }
      );
      if (!claimed) return res.status(400).json({ success: false, message: 'This promo has been fully used' });
      discount = promo.discountFor(check.totalFee);
      totalFee = check.totalFee - discount;
      promoCode = promo.code;
    }

    let booking;
    try {
      booking = await Booking.create({
      user: req.user._id,
      court: court._id,
      courtName: court.name,
      date: check.bookingDate,
      startTime,
      endTime: check.endTime,
      referenceNumber: generateReferenceNumber(),
      totalFee,
      discount,
      promoCode,
      paymentStatus: totalFee === 0 ? 'paid' : 'pending', // a 100% promo needs no payment
<<<<<<< HEAD:backend/routes/bookingRoutes.js
      status: 'pending', // stays pending until staff approve it (AF-116)
=======
      status: 'pending', // always starts pending; becomes confirmed only when an admin approves it
>>>>>>> a7268bdf5982b171a935f488c3beb16a426aba2c:routes/bookingRoutes.js
      });
    } catch (e) {
      if (claimed) await Promotion.updateOne({ _id: claimed._id }, { $inc: { usedCount: -1 } }); // slot taken: give the use back
      throw e;
    }

    // Validation phase: if the court's schedule changed after we read it (a block, new hours, a status
    // change, another booking), undo this booking and restart the request with a new timestamp.
    await U.commitScheduleOrUndo(court, async () => {
      await Booking.deleteOne({ _id: booking._id });
      if (claimed) await Promotion.updateOne({ _id: claimed._id }, { $inc: { usedCount: -1 } });
    });

    await U.notify(
      req.user._id,
<<<<<<< HEAD:backend/routes/bookingRoutes.js
      `Booking ${booking.referenceNumber} received for ${court.name} on ${date}, ${startTime}. It will be confirmed once the facility approves it.`,
      { subject: `Booking received: ${court.name}, ${date} ${startTime}`, booking }
=======
      `Booking ${booking.referenceNumber} for ${court.name} on ${date}, ${startTime} is pending. It will be confirmed once the facility approves it.`
>>>>>>> a7268bdf5982b171a935f488c3beb16a426aba2c:routes/bookingRoutes.js
    );

    res.status(201).json({ success: true, booking });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * UF-121 / AF-121 - customer submits how they paid so staff can verify it.
 * POST /api/bookings/:id/payment-proof   body: { method, reference }
 */
router.post('/:id/payment-proof', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking || booking.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    C.assertFresh(req, booking, 'booking');
    if (['cancelled', 'rejected'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'This booking is cancelled' });
    }
    if (!['pending', 'failed'].includes(booking.paymentStatus)) {
      return res.status(400).json({ success: false, message: `Payment is already ${booking.paymentStatus}` });
    }
    const method = String(req.body.method || '').trim().slice(0, 40);
    const reference = String(req.body.reference || '').trim().slice(0, 60);
    if (!method || !reference) {
      return res.status(400).json({ success: false, message: 'Choose how you paid and enter the reference number' });
    }
    booking.paymentMethod = method;
    booking.paymentReference = reference;
    booking.paymentSubmittedAt = new Date();
    booking.paymentStatus = 'pending'; // a rejected payment goes back into the queue
    booking.paymentNote = '';
    await booking.save();
    await U.notify(req.user._id, `We received your payment details for booking ${booking.referenceNumber}. Staff will verify them shortly.`);
    res.json({ success: true, booking });
  } catch (err) {
    handleError(res, err);
  }
});

/** UF-123..UF-126 - customer booking management */
router.patch('/:id/cancel', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking || booking.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    C.assertFresh(req, booking, 'booking');
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Only pending or confirmed bookings can be cancelled' });
    }

    const reason = String(req.body.reason || 'Customer cancelled this booking').trim() || 'Customer cancelled this booking';
    booking.status = 'cancelled';
    booking.statusReason = reason;
    booking.statusChangedAt = new Date();
    booking.statusChangedBy = req.user._id;
    if (booking.paymentStatus === 'paid') booking.paymentStatus = 'refunded';
    await booking.save();

<<<<<<< HEAD:backend/routes/bookingRoutes.js
    await U.notify(req.user._id, `Your booking ${booking.referenceNumber} was cancelled. Reason: ${reason}`);
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email;
    await U.notifyStaff(
      `${who} cancelled booking ${booking.referenceNumber} (${booking.courtName}, ${U.toDateStr(booking.date)} ${booking.startTime}). Reason: ${reason}`
    );
=======
           const refundNote = booking.paymentStatus === 'refunded' ? ' Your payment will be refunded.' : '';
       
          await U.notify(req.user._id, `Cancelled: your booking ${booking.referenceNumber} for ${booking.courtName} on ${U.toDateStr(booking.date)} at ${booking.startTime} was cancelled. Reason: ${reason}.${refundNote}`);
              // tell the facility: the slot is free again, and a paid booking needs its money returned
    const staffRefund = booking.paymentStatus === 'refunded' ? ` It was paid (₱${booking.totalFee}): please return the payment to the customer.` : '';
    await U.notifyStaff(`Customer cancelled: ${req.user.firstName} ${req.user.lastName} cancelled booking ${booking.referenceNumber} (${booking.courtName}, ${U.toDateStr(booking.date)} ${booking.startTime}-${booking.endTime}). Reason: ${reason}.${staffRefund}`);
>>>>>>> a7268bdf5982b171a935f488c3beb16a426aba2c:routes/bookingRoutes.js
    res.json({ success: true, booking });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/checkin', async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    C.assertFresh(req, booking, 'booking');
    if (!['confirmed', 'completed'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Only confirmed bookings can be checked in' });
    }
    if (U.toDateStr(booking.date) !== U.todayStr()) {
      return res.status(400).json({ success: false, message: 'Check-in is only available on the booking date' });
    }
    if (booking.checkedInAt) {
      return res.status(409).json({ success: false, message: 'You are already checked in' });
    }

    const checkedInAt = new Date();
    const updated = await Booking.findOneAndUpdate(
      {
        _id: booking._id,
        user: req.user._id,
        status: { $in: ['confirmed', 'completed'] },
        checkedInAt: { $exists: false },
      },
      { $set: { checkedInAt } },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ success: false, message: 'This booking has already been checked in' });
    }

    res.json({ success: true, booking: updated });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:id/reschedule', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking || booking.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    C.assertFresh(req, booking, 'booking');
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Only pending or confirmed bookings can be rescheduled' });
    }

    const { date, startTime, courtId } = req.body;
    const targetCourtId = courtId || booking.court.toString();
    const targetDate = date || U.toDateStr(booking.date);
    const targetStart = startTime || booking.startTime;

    if (!mongoose.isValidObjectId(targetCourtId)) {
      return res.status(400).json({ success: false, message: 'Invalid courtId' });
    }

    const court = await Court.findById(targetCourtId);
    if (!court) return res.status(404).json({ success: false, message: 'Court not found' });

    const check = await U.validateSlot(court, targetDate, targetStart, { excludeBookingId: booking._id });
    if (!check.ok) {
      return res.status(check.code).json({ success: false, message: check.message });
    }
    // the customer can't move onto a time they already hold on another court
    const ownClash = await Booking.findOne({
      user: req.user._id, _id: { $ne: booking._id }, date: check.bookingDate, startTime: targetStart,
      status: { $in: ['pending', 'confirmed'] },
    });
    if (ownClash) {
      return res.status(409).json({ success: false, message: `You already have booking ${ownClash.referenceNumber} at that date and time. Please choose another time.` });
    }

    const before = {
      court: booking.court, courtName: booking.courtName, date: booking.date, startTime: booking.startTime,
      endTime: booking.endTime, statusChangedAt: booking.statusChangedAt, statusChangedBy: booking.statusChangedBy,
      statusReason: booking.statusReason, reminderSentAt: booking.reminderSentAt,
    };

    booking.court = court._id;
    booking.courtName = court.name;
    booking.date = check.bookingDate;
    booking.startTime = targetStart;
    booking.endTime = check.endTime;
    booking.status = 'pending'; // a new time needs approval again
    booking.reminderSentAt = undefined;
    booking.statusChangedAt = new Date();
    booking.statusChangedBy = req.user._id;
    booking.statusReason = 'Customer rescheduled booking';
    await booking.save(); // conditional on the booking's W-TS

    // the target court's schedule must not have changed since we checked the slot
    await U.commitScheduleOrUndo(court, () => Booking.updateOne({ _id: booking._id, writeTS: booking.writeTS }, { $set: before }));

    await U.notify(req.user._id, `Your booking ${booking.referenceNumber} was rescheduled to ${court.name} on ${targetDate} at ${targetStart}. It will be confirmed once the facility approves the new time.`);
    res.json({ success: true, booking });
  } catch (err) {
    handleError(res, err);
  }
});

/** HitPay / setup problems are logged for staff; customers get a plain message. */
const payOnlineError = (req, res, err) => {
  if (err.status === 502) {
    console.error(`Pay online failed for booking ${req.params.id}:`, err.message);
    return res.status(502).json({ success: false, message: "Online payment isn't available right now. Please try again later or pay at the facility." });
  }
  if (err.status) return res.status(err.status).json({ success: false, message: err.message });
  return handleError(res, err);
};

/**
 * UF-121 - customer pays online (HitPay: GCash, QR Ph, cards and more).
 * POST /api/bookings/:id/pay-online -> { checkoutUrl }. Owner only; only when HitPay is on.
 */
router.post('/:id/pay-online', async (req, res) => {
  try {
    const { isActive } = require('../utils/integrations');
    const hitpay = require('../utils/integrations/hitpay');
    if (!(await isActive('hitpay'))) {
      return res.status(400).json({ success: false, message: 'Online payment is not available right now. You can pay at the facility.' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking || booking.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const { hitpay: link } = await hitpay.ensurePaymentLink(booking, { by: req.user._id });
    res.json({ success: true, checkoutUrl: link.checkoutUrl, amount: link.amount });
  } catch (err) { payOnlineError(req, res, err); }
});

/**
 * The customer is back from HitPay's checkout: ask HitPay (never the browser) whether it was paid.
 * POST /api/bookings/:id/pay-online/check -> { paid, paymentStatus }. Owner only; at most once per 10 s per booking.
 */
router.post('/:id/pay-online/check', async (req, res) => {
  try {
    const hitpay = require('../utils/integrations/hitpay');
    const booking = await Booking.findById(req.params.id);
    if (!booking || booking.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (!booking.hitpay || !booking.hitpay.requestId || booking.paymentStatus === 'paid') {
      return res.json({ success: true, paid: booking.paymentStatus === 'paid', paymentStatus: booking.paymentStatus });
    }
    // claim the check atomically, so reloading the page can't flood HitPay (its API allows 70 calls a minute)
    const since = new Date(Date.now() - 10 * 1000);
    const claimed = await Booking.findOneAndUpdate(
      { _id: booking._id, $or: [{ 'hitpay.checkedAt': { $exists: false } }, { 'hitpay.checkedAt': null }, { 'hitpay.checkedAt': { $lt: since } }] },
      { $set: { 'hitpay.checkedAt': new Date() } },
      { new: true }
    );
    if (!claimed) return res.json({ success: true, paid: false, paymentStatus: booking.paymentStatus, wait: true });
    const r = await hitpay.settleBooking(claimed);
    res.json({ success: true, paid: r.paid, paymentStatus: r.booking.paymentStatus });
  } catch (err) { payOnlineError(req, res, err); }
});

/**
 * QR check-in code for the customer's own confirmed booking - GET /api/bookings/:id/checkin-code
 * The front desk scans it under admin -> Check-ins.
 */
router.get('/:id/checkin-code', async (req, res) => {
  try {
    const { isActive } = require('../utils/integrations');
    if (!(await isActive('qrCheckin'))) return res.status(404).json({ success: false, message: 'QR check-in is not available' });
    const booking = await Booking.findById(req.params.id).select('user status');
    if (!booking || booking.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (booking.status !== 'confirmed') return res.status(400).json({ success: false, message: 'The QR code appears once your booking is confirmed' });
    res.json({ success: true, code: require('../utils/integrations/qr').makeCheckinCode(booking._id) });
  } catch (err) {
    handleError(res, err);
  }
});

/** UF-117 / UF-119 / UF-122 - GET /api/bookings/:id (owner only) */
router.get('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('court', 'name location pricePerHour');
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this booking' });
    }
    res.json({ success: true, booking });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
