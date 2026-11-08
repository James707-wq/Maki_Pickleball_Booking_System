const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Court = require('../models/Court');
const Booking = require('../models/Booking');
const BlockedSlot = require('../models/BlockedSlot');
const Settings = require('../models/Settings');
const { protect, authorize } = require('../middleware/auth');
const { FEATURES, PERMISSIONS, can } = require('../config/permissions');
const U = require('../utils/bookingUtils');
const handleError = require('../utils/handleError');
const audit = require('../middleware/audit');
const { logTransaction } = require('../utils/transactions');

const router = express.Router();

// Everything here needs a logged-in staff/admin. Customers get 403.
router.use(protect, authorize('dashboard'));
router.use(audit); // AF-135: records every successful write

router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  next();
});

const escapeRegex = (s) => String(s).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];
const COURT_STATUSES = ['available', 'unavailable', 'maintenance', 'closed'];
const fmt = (d) => U.toDateStr(d);

/* ------------------------------------------------------------------ */
/* AF-101 / AF-103: who am I                                           */
/* ------------------------------------------------------------------ */
router.get('/me', (req, res) => {
  const u = req.user;
  res.json({
    success: true,
    user: { id: u._id, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone, role: u.role },
    permissions: PERMISSIONS[u.role] || [],
  });
});

/* ------------------------------------------------------------------ */
/* AF-102 Admin Dashboard                                              */
/* ------------------------------------------------------------------ */
router.get('/dashboard', async (req, res) => {
  try {
    await U.autoCompleteBookings();

    const today = U.manilaMidnight(U.todayStr());
    const DAY = 24 * 60 * 60 * 1000;
    const windowStart = new Date(today.getTime() - 6 * DAY);
    const windowEnd = new Date(today.getTime() + 7 * DAY);

    const [
      totalCustomers, totalStaff, totalCourts, availableCourts,
      totalBookings, pendingBookings, todaysBookings,
      paidAmount, paidCount, owedAmount, owedCount, perDay, recent,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: { $in: ['staff', 'admin'] } }),
      Court.countDocuments(),
      Court.countDocuments({ status: 'available' }),
      Booking.countDocuments({ status: { $in: U.ACTIVE_STATUSES } }),
      Booking.countDocuments({ status: 'pending' }),
      Booking.countDocuments({ date: today, status: { $in: U.ACTIVE_STATUSES } }),
      Booking.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: null, amount: { $sum: '$totalFee' } } },
      ]),
      Booking.countDocuments({ paymentStatus: 'paid' }),
      Booking.aggregate([
        { $match: { paymentStatus: 'pending', status: { $in: U.ACTIVE_STATUSES } } },
        { $group: { _id: null, amount: { $sum: '$totalFee' } } },
      ]),
      Booking.countDocuments({ paymentStatus: 'pending', status: { $in: U.ACTIVE_STATUSES } }),
      Booking.aggregate([
        { $match: { date: { $gte: windowStart, $lte: windowEnd }, status: { $in: U.ACTIVE_STATUSES } } },
        { $group: { _id: '$date', count: { $sum: 1 } } },
      ]),
      Booking.find().sort({ createdAt: -1 }).limit(8).populate('user', 'firstName lastName email'),
    ]);

    const countByDate = {};
    perDay.forEach((r) => { countByDate[fmt(r._id)] = r.count; });
    const series = [];
    for (let i = -6; i <= 7; i++) {
      const key = fmt(new Date(today.getTime() + i * DAY));
      series.push({ date: key, count: countByDate[key] || 0, isToday: i === 0 });
    }

    res.json({
      success: true,
      data: {
        totalCustomers, totalStaff, totalCourts, availableCourts,
        totalBookings, pendingBookings, todaysBookings,
        revenue: paidAmount[0]?.amount || 0,
        paidCount,
        outstanding: owedAmount[0]?.amount || 0,
        outstandingCount: owedCount,
        series,
        recent,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* AF-105 User Management / AF-106 Staff Management / AF-107 Roles     */
/* ------------------------------------------------------------------ */
const userView = (u, extra = {}) => ({
  id: u._id, firstName: u.firstName, lastName: u.lastName, email: u.email,
  phone: u.phone, role: u.role, isActive: u.isActive, createdAt: u.createdAt, ...extra,
});
// Customer accounts need "users"; staff/admin accounts need "staff".
const featureForRole = (role) => (role === 'user' ? 'users' : 'staff');
const denyUnless = (req, res, feature) => {
  if (can(req.user.role, feature)) return false;
  bad(res, "You don't have access to this feature", 403);
  return true;
};

router.get('/users', async (req, res) => {
  try {
    const type = ['staff', 'all'].includes(req.query.type) ? req.query.type : 'customers';
    if (denyUnless(req, res, type === 'staff' ? 'staff' : type === 'all' ? 'roles' : 'users')) return;

    const filter = {};
    if (type === 'customers') filter.role = 'user';
    if (type === 'staff') filter.role = { $in: ['staff', 'admin'] };
    if (req.query.active === 'true') filter.isActive = true;
    if (req.query.active === 'false') filter.isActive = false;
    if (req.query.q) {
      const safe = escapeRegex(req.query.q);
      filter.$or = ['firstName', 'lastName', 'email', 'phone'].map((f) => ({ [f]: { $regex: safe, $options: 'i' } }));
    }

    const users = await User.find(filter).sort({ createdAt: -1 }).limit(300);

    let counts = {};
    if (type !== 'staff' && users.length) {
      const rows = await Booking.aggregate([
        { $match: { user: { $in: users.map((u) => u._id) }, status: { $in: U.ACTIVE_STATUSES } } },
        { $group: { _id: '$user', n: { $sum: 1 } } },
      ]);
      rows.forEach((r) => { counts[String(r._id)] = r.n; });
    }

    res.json({ success: true, users: users.map((u) => userView(u, { bookingCount: counts[String(u._id)] || 0 })) });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/users', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;
    const role = req.body.role || 'user';
    if (!['user', 'staff', 'admin'].includes(role)) return bad(res, 'Invalid role');
    if (denyUnless(req, res, featureForRole(role))) return;
    if (!firstName || !lastName || !email || !password) return bad(res, 'First name, last name, email and password are required');
    if (String(password).length < 8) return bad(res, 'Password must be at least 8 characters');

    const user = await User.create({ firstName, lastName, email, phone, password, role });
    res.status(201).json({ success: true, user: userView(user) });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return bad(res, 'User not found', 404);
    if (denyUnless(req, res, featureForRole(user.role))) return;

    const { firstName, lastName, email, phone, password } = req.body;
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (email !== undefined) user.email = email;
    if (phone !== undefined) user.phone = phone;
    if (password) {
      if (String(password).length < 8) return bad(res, 'Password must be at least 8 characters');
      user.password = password;
    }
    await user.save();
    res.json({ success: true, user: userView(user) });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/users/:id/active', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return bad(res, 'User not found', 404);
    if (denyUnless(req, res, featureForRole(user.role))) return;
    if (String(user._id) === String(req.user._id)) return bad(res, "You can't deactivate your own account");
    if (typeof req.body.isActive !== 'boolean') return bad(res, 'isActive must be true or false');

    user.isActive = req.body.isActive;
    await user.save();
    res.json({ success: true, user: userView(user) });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/users/:id/role', authorize('roles'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'staff', 'admin'].includes(role)) return bad(res, 'Invalid role');
    const user = await User.findById(req.params.id);
    if (!user) return bad(res, 'User not found', 404);
    if (String(user._id) === String(req.user._id)) return bad(res, "You can't change your own role");

    user.role = role;
    await user.save();
    res.json({ success: true, user: userView(user) });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/roles', authorize('roles'), async (req, res) => {
  try {
    const rows = await User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]);
    const counts = { user: 0, staff: 0, admin: 0 };
    rows.forEach((r) => { counts[r._id] = r.n; });
    res.json({ success: true, features: FEATURES, permissions: PERMISSIONS, counts });
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* AF-108..AF-111 Court management                                     */
/* ------------------------------------------------------------------ */
const parseFacilities = (v) =>
  Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean)
    : String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/** Future pending/confirmed bookings on a court that would not fit a new hours/slot setup. */
async function bookingsBreakingGrid(courtId, open, close, step) {
  const today = U.manilaMidnight(U.todayStr());
  const future = await Booking.find({
    court: courtId, date: { $gte: today }, status: { $in: ['pending', 'confirmed'] },
  }).select('startTime');
  const o = U.toMinutes(open);
  const c = U.toMinutes(close);
  return future.filter((b) => {
    const s = U.toMinutes(b.startTime);
    return s < o || s + step > c || (s - o) % step !== 0;
  }).length;
}

const checkTimes = (open, close, step) => {
  if (!TIME_RE.test(open) || !TIME_RE.test(close)) return 'Hours must be in HH:MM format';
  if (U.toMinutes(open) >= U.toMinutes(close)) return 'Closing time must be later than opening time';
  if (!Number.isInteger(step) || step < 15 || step > 240) return 'Slot length must be between 15 and 240 minutes';
  if (U.toMinutes(close) - U.toMinutes(open) < step) return 'Slot length is longer than the opening hours';
  return null;
};

router.get('/courts', authorize('courts.view'), async (req, res) => {
  try {
    const today = U.manilaMidnight(U.todayStr());
    const [courts, rows] = await Promise.all([
      Court.find().sort({ name: 1 }),
      Booking.aggregate([
        { $match: { date: { $gte: today }, status: { $in: ['pending', 'confirmed'] } } },
        { $group: { _id: '$court', n: { $sum: 1 } } },
      ]),
    ]);
    const upcoming = {};
    rows.forEach((r) => { upcoming[String(r._id)] = r.n; });
    res.json({
      success: true,
      courts: courts.map((c) => ({ ...c.toObject(), upcomingBookings: upcoming[String(c._id)] || 0 })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/courts', authorize('courts.manage'), async (req, res) => {
  try {
    const settings = await Settings.get();
    const b = req.body;
    const openTime = b.openTime || settings.openTime;
    const closeTime = b.closeTime || settings.closeTime;
    const step = b.slotDurationMinutes !== undefined ? Number(b.slotDurationMinutes) : 60;
    const timeErr = checkTimes(openTime, closeTime, step);
    if (timeErr) return bad(res, timeErr);
    if (b.status && !COURT_STATUSES.includes(b.status)) return bad(res, 'Invalid status');

    const court = await Court.create({
      name: b.name, courtNumber: b.courtNumber, location: b.location, description: b.description,
      facilities: parseFacilities(b.facilities), imageUrl: b.imageUrl,
      pricePerHour: b.pricePerHour === '' || b.pricePerHour === undefined ? undefined : Number(b.pricePerHour),
      status: b.status || 'available', openTime, closeTime, slotDurationMinutes: step,
    });
    res.status(201).json({ success: true, court });
  } catch (err) {
    handleError(res, err);
  }
});

// AF-109 details + AF-113 slot length + per-court hours
router.put('/courts/:id', authorize('courts.manage'), async (req, res) => {
  try {
    const court = await Court.findById(req.params.id);
    if (!court) return bad(res, 'Court not found', 404);
    const b = req.body;

    const openTime = b.openTime ?? court.openTime;
    const closeTime = b.closeTime ?? court.closeTime;
    const step = b.slotDurationMinutes !== undefined ? Number(b.slotDurationMinutes) : court.slotDurationMinutes;
    const timeErr = checkTimes(openTime, closeTime, step);
    if (timeErr) return bad(res, timeErr);

    const changed = openTime !== court.openTime || closeTime !== court.closeTime || step !== court.slotDurationMinutes;
    if (changed) {
      const breaking = await bookingsBreakingGrid(court._id, openTime, closeTime, step);
      if (breaking) {
        return bad(res, `${breaking} upcoming booking(s) would no longer fit these hours/slot length. Reschedule or cancel them first.`, 409);
      }
    }

    ['name', 'courtNumber', 'location', 'description', 'imageUrl'].forEach((f) => {
      if (b[f] !== undefined) court[f] = b[f];
    });
    if (b.facilities !== undefined) court.facilities = parseFacilities(b.facilities);
    court.openTime = openTime;
    court.closeTime = closeTime;
    court.slotDurationMinutes = step;
    await court.save();

    // keep the denormalized name on existing bookings readable
    if (b.name !== undefined) await Booking.updateMany({ court: court._id }, { courtName: court.name });

    res.json({ success: true, court });
  } catch (err) {
    handleError(res, err);
  }
});

// AF-110 status
router.patch('/courts/:id/status', authorize('courts.status'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!COURT_STATUSES.includes(status)) return bad(res, 'Invalid status');
    const court = await Court.findById(req.params.id);
    if (!court) return bad(res, 'Court not found', 404);

    court.status = status;
    await court.save();

    let affectedBookings = 0;
    if (status !== 'available') {
      affectedBookings = await Booking.countDocuments({
        court: court._id, date: { $gte: U.manilaMidnight(U.todayStr()) }, status: { $in: ['pending', 'confirmed'] },
      });
    }
    res.json({ success: true, court, affectedBookings });
  } catch (err) {
    handleError(res, err);
  }
});

// AF-111 pricing (existing bookings keep the fee they were made at)
router.patch('/courts/:id/price', authorize('courts.pricing'), async (req, res) => {
  try {
    const price = Number(req.body.pricePerHour);
    if (!Number.isFinite(price) || price < 0) return bad(res, 'Enter a valid price');
    const court = await Court.findById(req.params.id);
    if (!court) return bad(res, 'Court not found', 404);
    court.pricePerHour = price;
    await court.save();
    res.json({ success: true, court });
  } catch (err) {
    handleError(res, err);
  }
});

// AF-108 remove
router.delete('/courts/:id', authorize('courts.manage'), async (req, res) => {
  try {
    const court = await Court.findById(req.params.id);
    if (!court) return bad(res, 'Court not found', 404);

    const upcoming = await Booking.countDocuments({
      court: court._id, date: { $gte: U.manilaMidnight(U.todayStr()) }, status: { $in: ['pending', 'confirmed'] },
    });
    if (upcoming) {
      return bad(res, `This court has ${upcoming} upcoming booking(s). Cancel or move them first, or set the court to "closed" instead.`, 409);
    }
    await BlockedSlot.deleteMany({ court: court._id });
    await court.deleteOne();
    res.json({ success: true, message: 'Court removed' });
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* AF-112 Operating hours + booking rules                              */
/* ------------------------------------------------------------------ */
router.get('/settings', authorize('settings'), async (req, res) => {
  try {
    res.json({ success: true, settings: await Settings.get() });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/settings', authorize('settings'), async (req, res) => {
  try {
    const settings = await Settings.get();
    const openTime = req.body.openTime ?? settings.openTime;
    const closeTime = req.body.closeTime ?? settings.closeTime;
    const timeErr = checkTimes(openTime, closeTime, 15);
    if (timeErr) return bad(res, timeErr);

    let updatedCourts = 0;
    if (req.body.applyToCourts) {
      const courts = await Court.find();
      const problems = [];
      for (const c of courts) {
        const n = await bookingsBreakingGrid(c._id, openTime, closeTime, c.slotDurationMinutes);
        if (n) problems.push(`${c.name} (${n})`);
      }
      if (problems.length) {
        return bad(res, `Upcoming bookings would fall outside the new hours on: ${problems.join(', ')}. Reschedule them first.`, 409);
      }
      const r = await Court.updateMany({}, { openTime, closeTime });
      updatedCourts = r.modifiedCount;
    }

    settings.openTime = openTime;
    settings.closeTime = closeTime;
    if (typeof req.body.requireApproval === 'boolean') settings.requireApproval = req.body.requireApproval;
    await settings.save();

    res.json({ success: true, settings, updatedCourts });
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* AF-113 Time slots / AF-114 Schedule management                      */
/* ------------------------------------------------------------------ */
router.get('/schedule', authorize('schedule'), async (req, res) => {
  try {
    const { courtId, date } = req.query;
    if (!mongoose.isValidObjectId(courtId)) return bad(res, 'Choose a court');
    if (!U.isDateStr(date)) return bad(res, 'Date must be YYYY-MM-DD');
    const court = await Court.findById(courtId);
    if (!court) return bad(res, 'Court not found', 404);

    const dayStart = U.manilaMidnight(date);
    const [bookings, blocks] = await Promise.all([
      Booking.find({ court: court._id, date: dayStart, status: { $in: U.ACTIVE_STATUSES } })
        .populate('user', 'firstName lastName'),
      BlockedSlot.find({ court: court._id, date: dayStart }),
    ]);
    const byStart = {}; bookings.forEach((b) => { byStart[b.startTime] = b; });
    const blockByStart = {}; blocks.forEach((b) => { blockByStart[b.startTime] = b; });
    const now = new Date();
    const step = court.slotDurationMinutes;

    const slots = U.slotStarts(court.openTime, court.closeTime, step).map((start) => {
      const startTime = U.toHHMM(start);
      const booking = byStart[startTime];
      const block = blockByStart[startTime];
      const isPast = new Date(dayStart.getTime() + start * 60000) <= now;
      const slot = { startTime, endTime: U.toHHMM(start + step), status: isPast ? 'past' : 'available' };
      if (block) { slot.status = 'blocked'; slot.blockId = block._id; slot.reason = block.reason; }
      if (booking) {
        slot.status = 'booked';
        slot.booking = {
          id: booking._id, referenceNumber: booking.referenceNumber, status: booking.status,
          paymentStatus: booking.paymentStatus,
          customer: booking.user ? `${booking.user.firstName} ${booking.user.lastName}` : 'Deleted user',
        };
      }
      return slot;
    });

    res.json({
      success: true,
      court: { id: court._id, name: court.name, status: court.status, slotDurationMinutes: step },
      date, slots,
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/blocks', authorize('schedule'), async (req, res) => {
  try {
    const { courtId, date, startTime, reason, allDay } = req.body;
    if (!mongoose.isValidObjectId(courtId)) return bad(res, 'Choose a court');
    if (!U.isDateStr(date)) return bad(res, 'Date must be YYYY-MM-DD');
    const court = await Court.findById(courtId);
    if (!court) return bad(res, 'Court not found', 404);

    const step = court.slotDurationMinutes;
    const grid = U.slotStarts(court.openTime, court.closeTime, step);
    const dayStart = U.manilaMidnight(date);
    const now = new Date();

    let targets;
    if (allDay) {
      targets = grid;
    } else {
      if (!TIME_RE.test(String(startTime)) || !grid.includes(U.toMinutes(startTime))) {
        return bad(res, 'That is not a slot on this court\'s schedule');
      }
      targets = [U.toMinutes(startTime)];
    }
    targets = targets.filter((s) => new Date(dayStart.getTime() + s * 60000) > now); // only future slots
    if (!targets.length) return bad(res, 'Those slots have already passed');

    const taken = await Booking.find({ court: court._id, date: dayStart, status: { $in: U.ACTIVE_STATUSES } }).select('startTime');
    const takenSet = new Set(taken.map((b) => b.startTime));

    let blocked = 0;
    let skipped = 0;
    for (const s of targets) {
      const st = U.toHHMM(s);
      if (takenSet.has(st)) { skipped++; continue; }
      try {
        await BlockedSlot.create({
          court: court._id, date: dayStart, startTime: st, endTime: U.toHHMM(s + step),
          reason: String(reason || '').trim(), createdBy: req.user._id,
        });
        blocked++;
      } catch (e) {
        if (e.code !== 11000) throw e; // already blocked - fine
      }
    }
    if (!allDay && skipped) return bad(res, 'That slot already has a booking. Cancel or move the booking first.', 409);
    res.status(201).json({ success: true, blocked, skippedBooked: skipped });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/blocks/:id', authorize('schedule'), async (req, res) => {
  try {
    const removed = await BlockedSlot.findByIdAndDelete(req.params.id);
    if (!removed) return bad(res, 'Block not found', 404);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* AF-115..AF-119 Bookings                                             */
/* ------------------------------------------------------------------ */
const withRefs = (q) => q.populate('user', 'firstName lastName email phone').populate('court');

// AF-115 list + search + filter
router.get('/bookings', authorize('bookings'), async (req, res) => {
  try {
    await U.autoCompleteBookings();
    const { status, payment, courtId, date, q } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const filter = {};
    if (BOOKING_STATUSES.includes(status)) filter.status = status;
    if (PAYMENT_STATUSES.includes(payment)) filter.paymentStatus = payment;
    if (mongoose.isValidObjectId(courtId)) filter.court = courtId;
    if (U.isDateStr(date)) filter.date = U.manilaMidnight(date);
    if (q) {
      const safe = escapeRegex(q);
      const people = await User.find({
        $or: ['firstName', 'lastName', 'email'].map((f) => ({ [f]: { $regex: safe, $options: 'i' } })),
      }).select('_id').limit(100);
      filter.$or = [{ referenceNumber: { $regex: safe, $options: 'i' } }, { user: { $in: people.map((p) => p._id) } }];
    }

    const [total, bookings] = await Promise.all([
      Booking.countDocuments(filter),
      withRefs(Booking.find(filter).sort({ date: -1, startTime: -1 }).skip((page - 1) * limit).limit(limit)),
    ]);
    res.json({ success: true, total, page, pages: Math.max(Math.ceil(total / limit), 1), bookings });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/bookings/:id', authorize('bookings'), async (req, res) => {
  try {
    const booking = await withRefs(Booking.findById(req.params.id));
    if (!booking) return bad(res, 'Booking not found', 404);
    res.json({ success: true, booking });
  } catch (err) {
    handleError(res, err);
  }
});

// AF-116 approve/reject, AF-117 cancel, AF-119 any status change
router.patch('/bookings/:id/status', authorize('bookings'), async (req, res) => {
  try {
    const { status } = req.body;
    const reason = String(req.body.reason || '').trim();
    if (!BOOKING_STATUSES.includes(status)) return bad(res, 'Invalid status');

    const booking = await Booking.findById(req.params.id).populate('court');
    if (!booking) return bad(res, 'Booking not found', 404);
    if (booking.status === status) return bad(res, `Booking is already ${status}`);
    if (['cancelled', 'rejected'].includes(status) && !reason) {
      return bad(res, `Please give a reason for ${status === 'cancelled' ? 'cancelling' : 'rejecting'} this booking`);
    }

    const wasActive = U.ACTIVE_STATUSES.includes(booking.status);
    const willBeActive = U.ACTIVE_STATUSES.includes(status);
    if (!wasActive && willBeActive) {
      // bringing a cancelled/rejected booking back: the slot must still be free
      if (!booking.court) return bad(res, 'The court for this booking no longer exists', 409);
      const check = await U.validateSlot(booking.court, fmt(booking.date), booking.startTime, {
        excludeBookingId: booking._id, allowPast: true,
      });
      if (!check.ok) return bad(res, check.message, check.code);
    }

    booking.status = status;
    booking.statusReason = willBeActive ? '' : reason;
    booking.statusChangedBy = req.user._id;
    booking.statusChangedAt = new Date();
    await booking.save();

    const ref = booking.referenceNumber;
    const messages = {
      confirmed: `Your booking ${ref} has been confirmed.`,
      rejected: `Your booking ${ref} was not approved. Reason: ${reason}`,
      cancelled: `Your booking ${ref} was cancelled by the facility. Reason: ${reason}`,
      completed: `Your booking ${ref} is marked as completed. Thanks for playing!`,
    };
    if (messages[status]) await U.notify(booking.user, messages[status]);

    res.json({ success: true, booking: await withRefs(Booking.findById(booking._id)) });
  } catch (err) {
    handleError(res, err);
  }
});

// AF-118 reschedule (date, time and/or court)
router.patch('/bookings/:id/reschedule', authorize('bookings'), async (req, res) => {
  try {
    const { courtId, date, startTime } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return bad(res, 'Booking not found', 404);
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return bad(res, 'Only pending or confirmed bookings can be rescheduled');
    }

    const targetCourtId = courtId || String(booking.court);
    if (!mongoose.isValidObjectId(targetCourtId)) return bad(res, 'Invalid court');
    const court = await Court.findById(targetCourtId);
    if (!court) return bad(res, 'Court not found', 404);

    const sameCourt = String(court._id) === String(booking.court);
    if (sameCourt && date === fmt(booking.date) && startTime === booking.startTime) {
      return bad(res, 'That is the current date, time and court. Pick something different.');
    }

    const check = await U.validateSlot(court, date, startTime, { excludeBookingId: booking._id });
    if (!check.ok) return bad(res, check.message, check.code);

    const feeBefore = booking.totalFee;
    booking.court = court._id;
    booking.courtName = court.name;
    booking.date = check.bookingDate;
    booking.startTime = startTime;
    booking.endTime = check.endTime;
    if (!sameCourt) booking.totalFee = check.totalFee; // price follows the new court
    booking.statusChangedBy = req.user._id;
    booking.statusChangedAt = new Date();
    await booking.save();

    await U.notify(booking.user, `Your booking ${booking.referenceNumber} was moved to ${court.name} on ${date}, ${startTime}-${check.endTime}.`);

    res.json({
      success: true,
      feeChanged: feeBefore !== booking.totalFee,
      booking: await withRefs(Booking.findById(booking._id)),
    });
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* AF-120 Payments                                                     */
/* ------------------------------------------------------------------ */
router.get('/payments/summary', authorize('payments'), async (req, res) => {
  try {
    const group = (acc) => [{ $group: { _id: { p: '$paymentStatus', s: '$status' }, v: { $sum: acc } } }];
    const [amounts, counts] = await Promise.all([
      Booking.aggregate(group('$totalFee')),
      Booking.aggregate(group(1)),
    ]);
    const summary = {};
    PAYMENT_STATUSES.forEach((p) => { summary[p] = { count: 0, amount: 0 }; });
    const add = (rows, key) => rows.forEach((r) => {
      const dead = ['cancelled', 'rejected'].includes(r._id.s);
      // unpaid money on cancelled/rejected bookings is not "owed"
      if (dead && ['pending', 'failed'].includes(r._id.p)) return;
      summary[r._id.p][key] += r.v;
    });
    add(amounts, 'amount');
    add(counts, 'count');
    res.json({ success: true, summary });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/bookings/:id/payment', authorize('payments'), async (req, res) => {
  try {
    const { paymentStatus } = req.body;
    if (!PAYMENT_STATUSES.includes(paymentStatus)) return bad(res, 'Invalid payment status');
    const booking = await Booking.findById(req.params.id);
    if (!booking) return bad(res, 'Booking not found', 404);
    if (paymentStatus === 'paid' && ['cancelled', 'rejected'].includes(booking.status)) {
      return bad(res, "Can't record a payment on a cancelled or rejected booking");
    }
    if (booking.paymentStatus === paymentStatus) return bad(res, `Payment is already ${paymentStatus}`);

    booking.paymentStatus = paymentStatus;
    if (paymentStatus === 'refunded' && !booking.refund?.at) booking.refund = { amount: booking.totalFee, reason: 'Marked refunded', method: booking.paymentMethod, at: new Date(), by: req.user._id };
    if (req.body.paymentMethod !== undefined) booking.paymentMethod = String(req.body.paymentMethod).trim().slice(0, 40);
    booking.paidAt = paymentStatus === 'paid' ? new Date() : paymentStatus === 'pending' ? undefined : booking.paidAt;
    await booking.save();
        // AF-123: keep the transaction history in step with manual payment changes
    if (['paid', 'refunded', 'failed'].includes(paymentStatus)) {
      await logTransaction(booking, paymentStatus === 'paid' ? 'payment' : paymentStatus === 'refunded' ? 'refund' : 'failed',
        { method: booking.paymentMethod, by: req.user._id, note: 'Manual update' });
    }

    const ref = booking.referenceNumber;
    const messages = {
      paid: `Payment received for booking ${ref}. Thank you!`,
      refunded: `Your payment for booking ${ref} has been refunded.`,
      failed: `Payment for booking ${ref} could not be verified. Please settle it at the facility.`,
    };
    if (messages[paymentStatus]) await U.notify(booking.user, messages[paymentStatus]);

    res.json({ success: true, booking: await withRefs(Booking.findById(booking._id)) });
  } catch (err) {
    handleError(res, err);
  }
});

// AF-121 .. AF-135
router.use(require('./adminOpsRoutes'));

module.exports = router;
