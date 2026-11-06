const express = require('express');
const mongoose = require('mongoose');
const Court = require('../models/Court');
const Booking = require('../models/Booking');
const BlockedSlot = require('../models/BlockedSlot');
const { protect } = require('../middleware/auth');
const U = require('../utils/bookingUtils');
const handleError = require('../utils/handleError');

const router = express.Router();
router.use(protect); // remove this line if you want court browsing to be public

const escapeRegex = (s) => String(s).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ success: false, message: 'Court not found' });
  }
  next();
});

/** UF-109 View / UF-112 Search / UF-113 Filter - GET /api/courts?q=&status=&facility= */
router.get('/', async (req, res) => {
  try {
    const { q, status, facility } = req.query;
    const filter = {};
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { location: { $regex: safe, $options: 'i' } },
        { courtNumber: { $regex: safe, $options: 'i' } },
      ];
    }
    if (status) filter.status = String(status);
    if (facility) filter.facilities = { $regex: escapeRegex(facility), $options: 'i' };

    const courts = await Court.find(filter).sort({ name: 1 });
    res.json({ success: true, count: courts.length, courts });
  } catch (err) {
    handleError(res, err);
  }
});

/** UF-110 Court Information - GET /api/courts/:id */
router.get('/:id', async (req, res) => {
  try {
    const court = await Court.findById(req.params.id);
    if (!court) return res.status(404).json({ success: false, message: 'Court not found' });
    res.json({ success: true, court });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * UF-111 View Availability / UF-114 Schedule / UF-115 Select Date and Time
 * GET /api/courts/:id/availability?date=YYYY-MM-DD
 * Slot status: available | booked | blocked | past
 */
router.get('/:id/availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!U.isDateStr(date)) {
      return res.status(400).json({ success: false, message: 'Date must be YYYY-MM-DD' });
    }
    const court = await Court.findById(req.params.id);
    if (!court) return res.status(404).json({ success: false, message: 'Court not found' });
    if (court.status !== 'available') {
      return res.json({ success: true, courtStatus: court.status, slots: [] });
    }

    const dayStart = U.manilaMidnight(date);
    const [bookings, blocks] = await Promise.all([
      Booking.find({ court: court._id, date: dayStart, status: { $in: U.ACTIVE_STATUSES } }).select('startTime'),
      BlockedSlot.find({ court: court._id, date: dayStart }).select('startTime'),
    ]);
    const booked = new Set(bookings.map((b) => b.startTime));
    const blocked = new Set(blocks.map((b) => b.startTime));
    const now = new Date();
    const step = court.slotDurationMinutes;

    const slots = U.slotStarts(court.openTime, court.closeTime, step).map((start) => {
      const startTime = U.toHHMM(start);
      const isPast = new Date(dayStart.getTime() + start * 60000) <= now;
      return {
        startTime,
        endTime: U.toHHMM(start + step),
        status: booked.has(startTime) ? 'booked' : blocked.has(startTime) ? 'blocked' : isPast ? 'past' : 'available',
      };
    });

    res.json({ success: true, courtStatus: court.status, date, slots });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
