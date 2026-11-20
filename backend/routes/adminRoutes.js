const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Court = require('../models/Court');
const Booking = require('../models/Booking');
const BlockedSlot = require('../models/BlockedSlot');
const Settings = require('../models/Settings');
const Issue = require('../models/Issue');
const MaintenanceReport = require('../models/MaintenanceReport');
const { protect, authorize, adminSession } = require('../middleware/auth');
const { FEATURES, PERMISSIONS, can } = require('../config/permissions');
const U = require('../utils/bookingUtils');
const handleError = require('../utils/handleError');
const audit = require('../middleware/audit');
const { logTransaction } = require('../utils/transactions');
const C = require('../utils/concurrency');
const P = require('../utils/policy');
const CSV = require('../utils/csv'); // AF-143 export

// txRouter: every write route below runs as a timestamped transaction (abort + restart on conflict)
const router = C.txRouter(express.Router());

// Everything here needs a logged-in staff/admin. Customers get 403.
router.use(protect, adminSession, authorize('dashboard'));
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
const TIME_RANGES = { morning: ['00:00', '12:00'], afternoon: ['12:00', '17:00'], evening: ['17:00', '24:01'] }; // SF-126

/* ------------------------------------------------------------------ */
/* AF-101 / AF-103: who am I                                           */
/* ------------------------------------------------------------------ */
router.get('/me', (req, res) => {
  const u = req.user;
  res.json({
    success: true,
    user: {
      id: u._id, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone, role: u.role,
      avatar: u.avatar, // the customizable avatar (frontend/js/avatar.js), shown in the console sidebar
      pinSet: Boolean(u.securityPinSetAt), pinSetAt: u.securityPinSetAt || null, // security PIN for integration changes
    },
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

    const seesMoney = can(req.user.role, 'analytics'); // revenue totals: admins (staff handle payments, not the overview)
    // Staff dashboard: today at the facility - courts right now, check-ins, what needs attention, today's bookings
    const [todayList, courtList, verifications, openIssues, refunds, openRepairs, openIncidents, openHelp] = await Promise.all([
      Booking.find({ date: today, status: { $in: U.ACTIVE_STATUSES } }).sort({ startTime: 1 }).populate('user', 'firstName lastName').lean(),
      Court.find().sort({ name: 1 }).select('name status openTime closeTime').lean(),
      Booking.countDocuments({ paymentStatus: 'pending', paymentSubmittedAt: { $exists: true, $ne: null }, status: { $in: U.ACTIVE_STATUSES } }),
      Issue.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
      Booking.countDocuments({ paymentStatus: 'paid', status: { $in: ['cancelled', 'rejected'] }, totalFee: { $gt: 0 }, refundDue: { $ne: 0 } }),
      MaintenanceReport.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
      require('../models/Incident').countDocuments({ status: 'open' }),
      require('../models/HelpRequest').countDocuments({ status: 'open' }),
    ]);
    const nowMin = U.toMinutes(new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16)); // minutes into the day, Manila
    const courtsNow = courtList.map((c) => {
      const mine = todayList.filter((b) => String(b.court) === String(c._id));
      const cur = mine.find((b) => !b.checkedOutAt && U.toMinutes(b.startTime) <= nowMin && nowMin < U.toMinutes(b.endTime)); // checked out: they left
      const next = mine.find((b) => U.toMinutes(b.startTime) > nowMin);
      return {
        id: c._id, name: c.name, status: c.status, openTime: c.openTime, closeTime: c.closeTime,
        openNow: c.status === 'available' && nowMin >= U.toMinutes(c.openTime) && nowMin < U.toMinutes(c.closeTime),
        now: cur ? { id: cur._id, reference: cur.referenceNumber, customer: U.customerName(cur), until: cur.endTime, status: cur.status, checkedIn: Boolean(cur.checkedInAt && !cur.checkedOutAt) } : null,
        next: next ? { id: next._id, startTime: next.startTime, customer: U.customerName(next) } : null,
        bookedToday: mine.length,
      };
    });
    const arriving = todayList.filter((b) => b.status !== 'pending');
    const todayView = {
      now: `${String(Math.floor(nowMin / 60)).padStart(2, '0')}:${String(nowMin % 60).padStart(2, '0')}`,
      courts: courtsNow,
      checkins: {
        waiting: arriving.filter((b) => !b.checkedInAt && b.status === 'confirmed').length,
        onCourt: arriving.filter((b) => b.checkedInAt && !b.checkedOutAt).length,
        finished: arriving.filter((b) => b.checkedOutAt).length,
      },
      // only what this role can act on (staff without Payments or Issues get null)
      attention: {
        approvals: can(req.user.role, 'bookings') ? pendingBookings : null,
        verifications: can(req.user.role, 'payments') ? verifications : null,
        refunds: can(req.user.role, 'payments') ? refunds : null,
        issues: can(req.user.role, 'issues') ? openIssues : null,
        maintenance: can(req.user.role, 'maintenance') || can(req.user.role, 'maintenance.report') ? openRepairs : null,
        incidents: can(req.user.role, 'incidents') ? openIncidents : null,
        help: can(req.user.role, 'help') ? openHelp : null,
      },
      bookings: todayList.slice(0, 40).map((b) => ({
        _id: b._id, referenceNumber: b.referenceNumber, courtName: b.courtName, startTime: b.startTime, endTime: b.endTime,
        status: b.status, paymentStatus: b.paymentStatus, customer: U.customerName(b), source: b.source || 'online',
        checkedInAt: b.checkedInAt || null, checkedOutAt: b.checkedOutAt || null,
      })),
    };

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
        // staff dashboard: no money totals without Payments, no account counts without Customers / Staff
        totalCustomers: can(req.user.role, 'users') ? totalCustomers : null,
        totalStaff: can(req.user.role, 'staff') ? totalStaff : null,
        totalCourts, availableCourts,
        totalBookings, pendingBookings, todaysBookings,
        revenue: seesMoney ? paidAmount[0]?.amount || 0 : null,
        paidCount: seesMoney ? paidCount : null,
        outstanding: seesMoney ? owedAmount[0]?.amount || 0 : null,
        outstandingCount: seesMoney ? owedCount : null,
        series,
        recent,
        today: todayView,
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
  phone: u.phone, role: u.role, isActive: u.isActive, createdAt: u.createdAt, writeTS: u.writeTS, ...extra,
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
    C.assertFresh(req, user, 'account');

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
    C.assertFresh(req, user, 'account');
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
    C.assertFresh(req, user, 'account');

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
    // SF-121: a court with a booking being played right now shows as occupied (until when, by whom)
    const now = new Date();
    const playing = await Booking.find({ date: today, status: { $in: U.ACTIVE_STATUSES } }).populate('user', 'firstName lastName').lean();
    const inUse = {};
    playing.filter((b) => !b.checkedOutAt && U.startInstant(b) <= now && now < U.endInstant(b)).forEach((b) => { // checked out: they left
      inUse[String(b.court)] = { until: b.endTime, customer: U.customerName(b), bookingId: b._id, checkedIn: Boolean(b.checkedInAt && !b.checkedOutAt) };
    });
    res.json({
      success: true,
      courts: courts.map((c) => ({ ...c.toObject(), upcomingBookings: upcoming[String(c._id)] || 0, inUseNow: inUse[String(c._id)] || null })),
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
    C.assertFresh(req, court, 'court');
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
    if (changed) {
      // the upcoming-bookings check above is only valid if no booking/block landed since we read the court
      court.$where = { scheduleTS: court.scheduleTS || null };
      court.scheduleTS = C.nextTimestamp();
    }
    await court.save();

    // keep the denormalized name on existing bookings readable
    if (b.name !== undefined) {
      await Booking.updateMany({ court: court._id }, { courtName: court.name });
      const onCalendar = await Booking.find({ court: court._id, calendarEventId: { $exists: true } }).select('_id');
      const { syncBookingToCalendar } = require('../utils/integrations/google');
      setImmediate(async () => { for (const x of onCalendar) await syncBookingToCalendar(x._id); });
    }

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
    C.assertFresh(req, court, 'court');

    court.status = status;
    court.scheduleTS = C.nextTimestamp(); // bookings still in progress on this court must re-check its status
    await court.save();

    let affectedBookings = 0;
    if (status !== 'available') {
      affectedBookings = await Booking.countDocuments({
        court: court._id, date: { $gte: U.manilaMidnight(U.todayStr()) }, status: { $in: ['pending', 'confirmed'] },
      });
    }
    const STATE = { available: 'available again', maintenance: 'under maintenance', closed: 'closed', unavailable: 'not available' };
    await U.notifyStaff(`${court.name} is now ${STATE[status] || status} (set by ${req.user.firstName} ${req.user.lastName}).${affectedBookings ? ` It has ${affectedBookings} upcoming booking${affectedBookings === 1 ? '' : 's'}.` : ''}`,
      'courts.view', { except: req.user._id, link: '#/courts?tab=status' });
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
    C.assertFresh(req, court, 'court');
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
    C.assertFresh(req, court, 'court');

    const upcoming = await Booking.countDocuments({
      court: court._id, date: { $gte: U.manilaMidnight(U.todayStr()) }, status: { $in: ['pending', 'confirmed'] },
    });
    if (upcoming) {
      return bad(res, `This court has ${upcoming} upcoming booking(s). Cancel or move them first, or set the court to "closed" instead.`, 409);
    }
    // delete only if neither the court nor its schedule changed since the check above
    const removed = await Court.deleteOne({ _id: court._id, writeTS: court.writeTS || null, scheduleTS: court.scheduleTS || null });
    if (!removed.deletedCount) throw new C.WriteConflictError('This court changed while it was being removed. Please try again.');
    await BlockedSlot.deleteMany({ court: court._id });
    res.json({ success: true, message: 'Court removed' });
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* AF-112 Operating hours + booking rules                              */
/* ------------------------------------------------------------------ */
/**
 * The settings for the Hours & rules and Location pages: never the custom API's (sealed) secret.
 * rules are always complete (defaults filled in) and policyLines is what customers read.
 */
const settingsView = (s) => {
  const out = s.toObject();
  delete out.webhook;
  delete out.backup; // shown on the Backup & restore page
  out.rules = P.rulesOf(s);
  out.policyLines = P.describe(out.rules);
  return out;
};

router.get('/settings', authorize('settings'), async (req, res) => {
  try {
    res.json({ success: true, settings: settingsView(await Settings.get()) });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/settings', authorize('settings'), async (req, res) => {
  try {
    const settings = await Settings.get();
    C.assertFresh(req, settings, 'settings');
    const openTime = req.body.openTime ?? settings.openTime;
    const closeTime = req.body.closeTime ?? settings.closeTime;
    const timeErr = checkTimes(openTime, closeTime, 15);
    if (timeErr) return bad(res, timeErr);

    // facility location (map pin) - used for the weather forecast. Validated before anything is saved.
    const setLocation = 'facilityLat' in req.body || 'facilityLng' in req.body;
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const lat = num(req.body.facilityLat);
    const lng = num(req.body.facilityLng);
    if (setLocation) {
      if ((lat == null) !== (lng == null)) return bad(res, 'Set both latitude and longitude, or neither');
      if (lat != null && (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180))) return bad(res, 'That map location is not valid');
    }

    // AF-136 booking rules + payment settings, AF-137 cancellation policy: every problem at once, nothing saved
    const rules = P.checkSettings(req.body.rules && typeof req.body.rules === 'object' ? req.body.rules : {});
    if (rules.problems) return res.status(400).json({ success: false, message: `${rules.problems.join('. ')}.`, problems: rules.problems });

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
      // each court is updated only if its schedule is still the one we checked
      for (const c of courts) {
        if (c.openTime === openTime && c.closeTime === closeTime) continue;
        const r = await Court.updateOne(
          { _id: c._id, scheduleTS: c.scheduleTS || null },
          { $set: { openTime, closeTime, scheduleTS: C.nextTimestamp() } }
        );
        if (!r.matchedCount) throw new C.WriteConflictError('A court schedule changed while the hours were being applied. Please try again.');
        updatedCourts += 1;
      }
    }

    const hoursChanged = settings.openTime !== openTime || settings.closeTime !== closeTime;
    settings.openTime = openTime;
    settings.closeTime = closeTime;
    if (setLocation) {
      settings.facilityLat = lat;
      settings.facilityLng = lng;
    }
    if (typeof req.body.facilityAddress === 'string') settings.facilityAddress = req.body.facilityAddress.trim().slice(0, 200);
    const changedRules = Object.keys(rules.values).filter((k) => JSON.stringify(P.rulesOf(settings)[k]) !== JSON.stringify(rules.values[k]));
    Object.entries(rules.values).forEach(([k, v]) => { settings.set(`rules.${k}`, v); });
    if (changedRules.length) res.locals.auditDetail = `Changed booking rules / cancellation policy: ${changedRules.join(', ')}`;
    await settings.save();
    if (hoursChanged || changedRules.length) {
      await U.notifyStaff(`${hoursChanged ? `Opening hours are now ${openTime}-${closeTime}` : 'Booking rules or the cancellation policy changed'}${hoursChanged && changedRules.length ? ', and the booking rules changed' : ''} (by ${req.user.firstName} ${req.user.lastName}).`,
        'dashboard', { except: req.user._id });
    }

    res.json({ success: true, settings: settingsView(settings), updatedCourts });
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* AF-113 Time slots / AF-114 Schedule management                      */
/* ------------------------------------------------------------------ */
router.get('/schedule', authorize('schedule', 'schedule.view'), async (req, res) => { // staff: view only
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
          customer: U.customerName(booking), // walk-in guests have a name but no account
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
    const created = [];
    for (const s of targets) {
      const st = U.toHHMM(s);
      if (takenSet.has(st)) { skipped++; continue; }
      try {
        const blk = await BlockedSlot.create({
          court: court._id, date: dayStart, startTime: st, endTime: U.toHHMM(s + step),
          reason: String(reason || '').trim(), createdBy: req.user._id,
        });
        created.push(blk._id);
        blocked++;
      } catch (e) {
        if (e.code !== 11000) throw e; // already blocked - fine
      }
    }
    // a customer may have booked one of these slots while we were checking: validate the court schedule
    if (created.length) {
      await U.commitScheduleOrUndo(court, () => BlockedSlot.deleteMany({ _id: { $in: created } }));
    }
    if (!allDay && skipped) return bad(res, 'That slot already has a booking. Cancel or move the booking first.', 409);
    if (blocked) {
      await U.notifyStaff(`Schedule change: ${court.name} blocked on ${date}, ${allDay ? 'all day' : `${startTime}-${U.toHHMM(U.toMinutes(startTime) + step)}`}${String(reason || '').trim() ? ` (${String(reason).trim().slice(0, 80)})` : ''} by ${req.user.firstName} ${req.user.lastName}.`,
        'schedule.view', { except: req.user._id, link: `#/schedule?courtId=${court._id}&date=${date}` });
    }
    res.status(201).json({ success: true, blocked, skippedBooked: skipped });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/blocks/:id', authorize('schedule'), async (req, res) => {
  try {
    const removed = await BlockedSlot.findByIdAndDelete(req.params.id);
    if (!removed) return bad(res, 'Block not found', 404);
    const c = await Court.findById(removed.court).select('name');
    await U.notifyStaff(`Schedule change: ${c ? c.name : 'A court'} is open again on ${fmt(removed.date)}, ${removed.startTime}-${removed.endTime} (unblocked by ${req.user.firstName} ${req.user.lastName}).`,
      'schedule.view', { except: req.user._id, link: `#/schedule?courtId=${removed.court}&date=${fmt(removed.date)}` });
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
    const { status, payment, courtId, date, q, time } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const filter = {};
    if (BOOKING_STATUSES.includes(status)) filter.status = status;
    if (PAYMENT_STATUSES.includes(payment)) filter.paymentStatus = payment;
    if (mongoose.isValidObjectId(courtId)) filter.court = courtId;
    if (U.isDateStr(date)) filter.date = U.manilaMidnight(date);
    // SF-126: time of day (morning / afternoon / evening) or "playing at" a time (HH:MM)
    if (TIME_RANGES[time]) filter.startTime = { $gte: TIME_RANGES[time][0], $lt: TIME_RANGES[time][1] };
    else if (TIME_RE.test(String(time || ''))) { filter.startTime = { $lte: time }; filter.endTime = { $gt: time }; }
    if (q) { // SF-125: reference, customer or walk-in name (first, last or full), email, mobile, payment reference, a date
      const text = String(q).trim();
      const safe = escapeRegex(text);
      const re = { $regex: safe, $options: 'i' };
      const digits = text.replace(/\D/g, '');
      // "09175550199" also finds "0917 555 0199" and "0917-555-0199"
      const phone = digits.length >= 4 && digits.length === text.replace(/[\s+()-]/g, '').length
        ? { $regex: digits.slice(0, 15).split('').join('[\\s-]*'), $options: 'i' } : null;
      const people = await User.find({ $or: [
        { firstName: re }, { lastName: re }, { email: re },
        { $expr: { $regexMatch: { input: { $concat: ['$firstName', ' ', '$lastName'] }, regex: safe, options: 'i' } } },
        ...(phone ? [{ phone }] : []),
      ] }).select('_id').limit(200);
      filter.$or = [
        { referenceNumber: re }, { paymentReference: re }, { 'walkIn.name': re },
        ...(phone ? [{ 'walkIn.phone': phone }] : []),
        { user: { $in: people.map((p) => p._id) } },
        ...(U.isDateStr(text) ? [{ date: U.manilaMidnight(text) }] : []),
      ];
    }

    if (req.query.format === 'csv') { // AF-143 export: every booking matching the filters
      const all = await Booking.find(filter).sort({ date: -1, startTime: -1 }).limit(CSV.MAX_ROWS).populate('user', 'firstName lastName email phone').lean();
      return CSV.send(res, `Bookings ${U.todayStr()}`,
        ['Reference', 'Customer', 'Email', 'Phone', 'Court', 'Date', 'Time', 'Status', 'Reason', 'Payment', 'Paid with', 'Fee (PHP)', 'Discount (PHP)', 'Promo code', 'Booked on'],
        all.map((b) => [b.referenceNumber, U.customerName(b), b.user ? b.user.email : '', b.user ? b.user.phone || '' : (b.walkIn && b.walkIn.phone) || '',
          b.courtName, fmt(b.date), `${b.startTime}-${b.endTime}`, b.status, b.statusReason || '', b.paymentStatus, b.paymentMethod || '', b.totalFee, b.discount || 0, b.promoCode || '', b.createdAt]));
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

/* ------------------------------------------------------------------ */
/* Staff: Create Walk-in Booking (staff and admins with "bookings")    */
/* ------------------------------------------------------------------ */
/** Customers with an account to link a walk-in booking to: GET /api/admin/walk-in/customers?q=juan (name, email or mobile) */
router.get('/walk-in/customers', authorize('bookings'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, customers: [] });
    const safe = escapeRegex(q);
    const list = await User.find({ role: 'user', isActive: { $ne: false }, $or: ['firstName', 'lastName', 'email', 'phone'].map((f) => ({ [f]: { $regex: safe, $options: 'i' } })) })
      .select('firstName lastName email phone').sort({ firstName: 1, lastName: 1 }).limit(8).lean();
    res.json({ success: true, customers: list.map((u) => ({ id: u._id, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, phone: u.phone || '' })) });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/admin/bookings - a booking made at the desk for a walk-in customer.
 * body: { courtId, date, startTime, customerId | walkIn: { name, phone }, paymentMethod ('' = not paid yet) }
 * Confirmed at once (staff made it), without the customer booking rules (how far ahead, notice); the slot being
 * played right now can still be booked. Paid now: recorded like any payment, in Transaction history.
 */
router.post('/bookings', authorize('bookings'), async (req, res) => {
  try {
    const { courtId, date, startTime } = req.body;
    if (!mongoose.isValidObjectId(courtId)) return bad(res, 'Choose a court');
    if (!U.isDateStr(date) || !TIME_RE.test(String(startTime || ''))) return bad(res, 'Choose a date and a time');
    if (date < U.todayStr()) return bad(res, "A walk-in booking can't be made for a day that has passed");

    let customer = null;
    let walkIn = null;
    if (req.body.customerId) {
      if (!mongoose.isValidObjectId(req.body.customerId)) return bad(res, 'Customer not found', 404);
      customer = await User.findOne({ _id: req.body.customerId, role: 'user' });
      if (!customer) return bad(res, 'Customer not found', 404);
      if (customer.isActive === false) return bad(res, 'This customer account is deactivated');
    } else {
      const name = String((req.body.walkIn && req.body.walkIn.name) || '').trim().replace(/\s+/g, ' ');
      const phone = String((req.body.walkIn && req.body.walkIn.phone) || '').trim();
      if (name.length < 2) return bad(res, "Enter the walk-in customer's name, or choose a customer with an account");
      if (name.length > 80) return bad(res, 'The name can be at most 80 characters');
      if (phone && !/^[0-9+()\-\s]{7,20}$/.test(phone)) return bad(res, 'Enter a valid mobile number, or leave it empty');
      walkIn = { name, phone };
    }
    const paymentMethod = String(req.body.paymentMethod || '').trim().slice(0, 40);

    const court = await Court.findById(courtId);
    if (!court) return bad(res, 'Court not found', 404);
    const check = await U.validateSlot(court, date, startTime, { allowPast: true }); // the slot being played now is fine
    if (!check.ok) return bad(res, check.message, check.code);
    const now = new Date();
    if (U.endInstant({ date: check.bookingDate, endTime: check.endTime }) <= now) return bad(res, 'That time has already ended. Choose a later time.');

    const paid = Boolean(paymentMethod) && check.totalFee > 0;
    const booking = await Booking.create({
      user: customer ? customer._id : undefined,
      walkIn: walkIn || undefined,
      source: 'desk',
      createdBy: req.user._id,
      court: court._id, courtName: court.name, date: check.bookingDate, startTime, endTime: check.endTime,
      referenceNumber: U.newReference(),
      totalFee: check.totalFee,
      status: 'confirmed', statusChangedBy: req.user._id, statusChangedAt: now,
      paymentStatus: paid || check.totalFee === 0 ? 'paid' : 'pending',
      ...(paid ? { paymentMethod, paidAt: now, verifiedBy: req.user._id, verifiedAt: now } : {}),
    });
    // the court's schedule must not have changed since the slot was checked (another booking, a block, new hours)
    await U.commitScheduleOrUndo(court, () => Booking.deleteOne({ _id: booking._id }));
    if (paid) await logTransaction(booking, 'payment', { method: paymentMethod, note: 'Paid at the desk', by: req.user._id });

    const who = customer ? `${customer.firstName} ${customer.lastName}`.trim() : `${walkIn.name} (walk-in)`;
    if (customer) {
      await U.notify(customer._id, `Booking ${booking.referenceNumber} was made for you at the facility: ${court.name} on ${date} at ${startTime}. It is confirmed.${paid ? ` Paid with ${paymentMethod}.` : ''}`,
        { subject: `Confirmed: ${court.name}, ${date} ${startTime}`, booking, attachIcs: true });
    }
    res.locals.auditDetail = `Walk-in booking ${booking.referenceNumber} for ${who}: ${court.name}, ${date} ${startTime}-${check.endTime}${paid ? `, paid with ${paymentMethod}` : ', not paid yet'}`;
    res.status(201).json({ success: true, booking: await withRefs(Booking.findById(booking._id)) });
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
    C.assertFresh(req, booking, 'booking');
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

    const before = {
      status: booking.status, statusReason: booking.statusReason,
      statusChangedBy: booking.statusChangedBy, statusChangedAt: booking.statusChangedAt,
      slotActive: booking.slotActive, refundDue: booking.refundDue, refundRule: booking.refundRule,
    };
    booking.status = status;
    booking.statusReason = willBeActive ? '' : reason;
    booking.statusChangedBy = req.user._id;
    booking.statusChangedAt = new Date();
    // AF-137: the facility cancelling or not approving a paid booking always owes a full refund (Payments -> Refunds)
    const owesRefund = wasActive && !willBeActive && booking.paymentStatus === 'paid' && booking.totalFee > 0;
    if (owesRefund) {
      booking.refundDue = booking.totalFee;
      booking.refundRule = status === 'rejected' ? 'Not approved by the facility: full refund' : 'Cancelled by the facility: full refund';
    }
    await booking.save(); // conditional on the booking's W-TS

    if (!wasActive && willBeActive) {
      // the slot check above must still hold: nobody blocked/booked/closed it in between
      await U.commitScheduleOrUndo(booking.court, () => Booking.updateOne({ _id: booking._id, writeTS: booking.writeTS }, { $set: before }));
    }

    const ref = booking.referenceNumber;
    const refundNote = owesRefund ? `. Your payment of ₱${Number(booking.totalFee).toLocaleString('en-PH')} will be refunded in full.` : '';
    const messages = {
      confirmed: `Your booking ${ref} has been confirmed.`,
      rejected: `Your booking ${ref} was not approved. Reason: ${reason}${refundNote}`,
      cancelled: `Your booking ${ref} was cancelled by the facility. Reason: ${reason}${refundNote}`,
      completed: `Your booking ${ref} is marked as completed. Thanks for playing!`,
    };
    if (messages[status]) {
      const outside = status === 'completed' ? undefined : {
        subject: { confirmed: `Confirmed: ${booking.courtName}, ${fmt(booking.date)} ${booking.startTime}`, rejected: `Booking ${ref} was not approved`, cancelled: `Booking ${ref} was cancelled` }[status],
        booking, attachIcs: status === 'confirmed',
      };
      await U.notify(booking.user, messages[status], outside);
    }

    res.json({ success: true, booking: await withRefs(Booking.findById(booking._id)) });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * SF-123 Court Assignment: which courts are free for this booking's date and time, so staff can move the customer
 * to another court in one step (PATCH /bookings/:id/reschedule with { courtId }).
 * GET /api/admin/bookings/:id/courts -> { courts: [{ id, name, location, status, current, free, reason }] }
 */
router.get('/bookings/:id/courts', authorize('bookings'), async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).select('court date startTime endTime status');
    if (!booking) return bad(res, 'Booking not found', 404);
    const courts = await Court.find().sort({ name: 1 });
    const out = [];
    for (const c of courts) {
      const current = String(c._id) === String(booking.court);
      const check = current ? { ok: false, message: 'Booked here now' }
        : await U.validateSlot(c, fmt(booking.date), booking.startTime, { excludeBookingId: booking._id, allowPast: true });
      out.push({ id: c._id, name: c.name, location: c.location, status: c.status, current, free: Boolean(check.ok), reason: check.ok ? '' : check.message,
        fee: check.ok ? check.totalFee : null });
    }
    res.json({ success: true, date: fmt(booking.date), startTime: booking.startTime, endTime: booking.endTime, courts: out });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * SF-124 Daily Schedule: every reservation on one day, by time, with customer names, courts and statuses.
 * GET /api/admin/daily?date=YYYY-MM-DD&all=1 (all: also cancelled and rejected ones)
 */
router.get('/daily', authorize('schedule.view', 'bookings'), async (req, res) => {
  try {
    await U.autoCompleteBookings();
    const date = U.isDateStr(req.query.date) ? req.query.date : U.todayStr();
    const filter = { date: U.manilaMidnight(date) };
    if (req.query.all !== '1') filter.status = { $in: U.ACTIVE_STATUSES };
    const [list, courts] = await Promise.all([
      Booking.find(filter).sort({ startTime: 1, courtName: 1 }).populate('user', 'firstName lastName phone').lean(),
      Court.find().sort({ name: 1 }).select('name status').lean(),
    ]);
    res.json({
      success: true, date,
      courts: courts.map((c) => ({ id: c._id, name: c.name, status: c.status })),
      bookings: list.map((b) => ({
        _id: b._id, referenceNumber: b.referenceNumber, courtName: b.courtName, court: b.court, startTime: b.startTime, endTime: b.endTime,
        customer: U.customerName(b), phone: b.user ? b.user.phone || '' : (b.walkIn && b.walkIn.phone) || '', source: b.source || 'online',
        status: b.status, statusReason: b.statusReason || '', paymentStatus: b.paymentStatus, totalFee: b.totalFee,
        checkedInAt: b.checkedInAt || null, checkedOutAt: b.checkedOutAt || null,
      })),
    });
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
    C.assertFresh(req, booking, 'booking');
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

    // SF-123 Court Assignment: moving only the court keeps the time, which may already be under way
    const sameTime = date === fmt(booking.date) && startTime === booking.startTime;
    const check = await U.validateSlot(court, date, startTime, { excludeBookingId: booking._id, allowPast: sameTime });
    if (!check.ok) return bad(res, check.message, check.code);
    if (sameTime && U.endInstant({ date: check.bookingDate, endTime: check.endTime }) <= new Date()) return bad(res, 'This booking has already ended');

    const feeBefore = booking.totalFee;
    const before = {
      court: booking.court, courtName: booking.courtName, date: booking.date, startTime: booking.startTime,
      endTime: booking.endTime, totalFee: booking.totalFee, statusChangedBy: booking.statusChangedBy,
      statusChangedAt: booking.statusChangedAt, reminderSentAt: booking.reminderSentAt,
    };
    booking.court = court._id;
    booking.courtName = court.name;
    booking.date = check.bookingDate;
    booking.startTime = startTime;
    booking.endTime = check.endTime;
    // price follows the new court, unless the facility moves the customer (court assignment keeps what they agreed to)
    if (!sameCourt && req.body.keepFee !== true) booking.totalFee = check.totalFee;
    booking.reminderSentAt = undefined; // the reminder goes out again for the new time
    booking.statusChangedBy = req.user._id;
    booking.statusChangedAt = new Date();
    await booking.save(); // conditional on the booking's W-TS

    await U.commitScheduleOrUndo(court, () => Booking.updateOne({ _id: booking._id, writeTS: booking.writeTS }, { $set: before }));

    await U.notify(booking.user, `Your booking ${booking.referenceNumber} was moved to ${court.name} on ${date}, ${startTime}-${check.endTime}.`,
      { subject: `Booking ${booking.referenceNumber} moved to ${date} ${startTime}`, booking, attachIcs: booking.status === 'confirmed' });

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
    // staff (no analytics) see what is still to collect, not the business's takings
    if (!can(req.user.role, 'analytics')) { summary.paid.amount = null; summary.refunded.amount = null; }
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
    C.assertFresh(req, booking, 'booking');
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
router.use(require('./integrationRoutes')); // Google Calendar, HitPay, weather; on/off needs PIN + one-time code
router.use(require('./securityRoutes'));    // the admin's security PIN
router.use(require('./apiTokenAdminRoutes')); // API tokens for other systems (/api/v1)
router.use(require('./sessionAdminRoutes'));  // AF-141 who is signed in; end sessions
router.use(require('./backupRoutes'));        // AF-138 backup and restore, AF-139 data checks
router.use(require('./maintenanceRoutes'));   // SF-122 maintenance reports from staff
router.use(require('./incidentRoutes'));      // SF-130 incidents during customer sessions
router.use(require('./shiftRoutes'));         // SF-134 staff shifts
router.use(require('./helpRoutes'));          // SF-136 help requests to the administrators
router.use(require('./staffDeskRoutes'));     // SF-128 notice board, SF-131/133 daily report and court usage, SF-132 shift payments, SF-135 my activity
router.use(require('./adminOpsRoutes'));

module.exports = router;
