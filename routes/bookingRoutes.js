const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Court = require('../models/Court');
const Promotion = require('../models/Promotion');
const { protect } = require('../middleware/auth');
const U = require('../utils/bookingUtils');
const handleError = require('../utils/handleError');

const router = express.Router();
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
      status: 'pending', // always starts pending; becomes confirmed only when an admin approves it
      });
    } catch (e) {
      if (claimed) await Promotion.updateOne({ _id: claimed._id }, { $inc: { usedCount: -1 } }); // slot taken: give the use back
      throw e;
    }

    await U.notify(
      req.user._id,
      `Booking ${booking.referenceNumber} for ${court.name} on ${date}, ${startTime} is pending. It will be confirmed once the facility approves it.`
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

           const refundNote = booking.paymentStatus === 'refunded' ? ' Your payment will be refunded.' : '';
       await U.notify(req.user._id, `Cancelled: your booking ${booking.referenceNumber} for ${booking.courtName} on ${U.toDateStr(booking.date)} at ${booking.startTime} was cancelled. Reason: ${reason}.${refundNote}`);
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
           // the customer can't move onto a time they already hold on another court
       const ownClash = await Booking.findOne({
         user: req.user._id, _id: { $ne: booking._id }, date: check.bookingDate, startTime: targetStart,
         status: { $in: ['pending', 'confirmed'] },
       });
       if (ownClash) {
         return res.status(409).json({ success: false, message: `You already have booking ${ownClash.referenceNumber} at that date and time. Please choose another time.` });
       }
    if (!check.ok) {
      return res.status(check.code).json({ success: false, message: check.message });
    }

    booking.court = court._id;
    booking.courtName = court.name;
    booking.date = check.bookingDate;
    booking.startTime = targetStart;
    booking.endTime = check.endTime;
    booking.statusChangedAt = new Date();
    booking.statusChangedBy = req.user._id;
    booking.statusReason = 'Customer rescheduled booking';
    await booking.save();

    await U.notify(req.user._id, `Your booking ${booking.referenceNumber} was rescheduled to ${court.name} on ${targetDate} at ${targetStart}.`);
    res.json({ success: true, booking });
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
