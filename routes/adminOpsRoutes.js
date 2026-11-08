/**
 * Admin console, part 2: AF-121 .. AF-135.
 * Mounted inside adminRoutes, so every request here already passed `protect` + `authorize('dashboard')`.
 */
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Court = require('../models/Court');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Announcement = require('../models/Announcement');
   const announceCustomers = async (a, adminId) => {
     const users = await User.find({ role: 'user', isActive: true }).distinct('_id');
     if (!users.length) return;
     const batch = `ann-${Date.now().toString(36)}`;
     await Notification.insertMany(users.map((user) => ({ user, message: `New announcement: ${a.title}`, sentBy: adminId, batch })));
   };
const Promotion = require('../models/Promotion');
const Feedback = require('../models/Feedback');
const Issue = require('../models/Issue');
const AuditLog = require('../models/AuditLog');
const { authorize } = require('../middleware/auth');
const U = require('../utils/bookingUtils');
const { logTransaction } = require('../utils/transactions');
const handleError = require('../utils/handleError');

const router = express.Router();

router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ success: false, message: 'Not found' });
  next();
});

const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const escapeRegex = (s) => String(s).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pageOf = (req, def = 20) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || def, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};
const paged = (total, page, limit) => ({ total, page, pages: Math.max(Math.ceil(total / limit), 1) });
const withRefs = (q) => q.populate('user', 'firstName lastName email phone').populate('court', 'name location');
const methodOf = (v) => String(v || '').trim().slice(0, 40);

// "from"/"to" query -> Manila day range; defaults to the last 30 days
function range(req) {
  const to = U.isDateStr(req.query.to) ? req.query.to : U.todayStr();
  let from = U.isDateStr(req.query.from) ? req.query.from : null;
  if (!from) from = U.toDateStr(new Date(U.manilaMidnight(to).getTime() - 29 * 864e5));
  if (from > to) return null;
  const days = Math.round((U.manilaMidnight(to) - U.manilaMidnight(from)) / 864e5) + 1;
  if (days > 366) return null;
  return { from, to, days, gte: U.manilaMidnight(from), lt: new Date(U.manilaMidnight(to).getTime() + 864e5) };
}
const dayList = (r) => Array.from({ length: r.days }, (_, i) => U.toDateStr(new Date(U.manilaMidnight(r.from).getTime() + i * 864e5)));
const badRange = (res) => bad(res, 'Choose a valid date range (up to one year, start before end)');
const dead = (b) => ['cancelled', 'rejected'].includes(b.status);

/* ------------------------------------------------------------------ */
/* AF-121 Payment Verification                                         */
/* customers submit a reference; staff verify (paid) or reject (failed) */
/* ------------------------------------------------------------------ */
router.get('/payments/verification', authorize('payments'), async (req, res) => {
  try {
    const bookings = await withRefs(Booking.find({
      paymentStatus: 'pending', paymentSubmittedAt: { $exists: true, $ne: null }, status: { $in: ['pending', 'confirmed', 'completed'] },
    }).sort({ paymentSubmittedAt: 1 }).limit(200));
    res.json({ success: true, bookings });
  } catch (err) { handleError(res, err); }
});

router.post('/bookings/:id/verify-payment', authorize('payments'), async (req, res) => {
  try {
    const approve = req.body.approve === true || req.body.approve === 'true';
    const note = String(req.body.note || '').trim().slice(0, 200);
    const booking = await Booking.findById(req.params.id);
    if (!booking) return bad(res, 'Booking not found', 404);
    if (booking.paymentStatus !== 'pending') return bad(res, `This payment is already ${booking.paymentStatus}`);
    if (!booking.paymentSubmittedAt) return bad(res, 'The customer has not submitted a payment yet');
    if (dead(booking)) return bad(res, 'This booking is cancelled or rejected');
    if (!approve && !note) return bad(res, 'Please give a reason so the customer knows what to fix');

    booking.paymentStatus = approve ? 'paid' : 'failed';
    booking.verifiedBy = req.user._id;
    booking.verifiedAt = new Date();
    booking.paymentNote = approve ? '' : note;
    if (approve) booking.paidAt = new Date();
    await booking.save();
    await logTransaction(booking, approve ? 'payment' : 'failed', { method: booking.paymentMethod, note: approve ? `Verified, ref ${booking.paymentReference}` : note, by: req.user._id });
    await U.notify(booking.user, approve
      ? `Payment for booking ${booking.referenceNumber} was verified. Thank you!`
      : `Payment for booking ${booking.referenceNumber} could not be verified: ${note}. You can submit it again.`);
    res.json({ success: true, booking: await withRefs(Booking.findById(booking._id)) });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-122 Refund Management                                            */
/* ------------------------------------------------------------------ */
router.get('/refunds', authorize('payments'), async (req, res) => {
  try {
    const [eligible, done] = await Promise.all([
      withRefs(Booking.find({ paymentStatus: 'paid', status: { $in: ['cancelled', 'rejected'] } }).sort({ statusChangedAt: -1, updatedAt: -1 }).limit(100)),
      withRefs(Booking.find({ paymentStatus: 'refunded' }).sort({ 'refund.at': -1, updatedAt: -1 }).limit(100)),
    ]);
    res.json({ success: true, eligible, done });
  } catch (err) { handleError(res, err); }
});

router.post('/bookings/:id/refund', authorize('payments'), async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim().slice(0, 200);
    if (!reason) return bad(res, 'Please record the reason for the refund');
    const booking = await Booking.findById(req.params.id);
    if (!booking) return bad(res, 'Booking not found', 404);
    if (booking.paymentStatus !== 'paid') return bad(res, 'Only paid bookings can be refunded');
    const amount = req.body.amount === undefined || req.body.amount === '' ? booking.totalFee : Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > booking.totalFee) return bad(res, `Refund must be between 1 and ${booking.totalFee}`);

    booking.paymentStatus = 'refunded';
    booking.refund = { amount, reason, method: methodOf(req.body.method) || booking.paymentMethod, at: new Date(), by: req.user._id };
    await booking.save();
    await logTransaction(booking, 'refund', { amount, method: booking.refund.method, note: reason, by: req.user._id });
    await U.notify(booking.user, `A refund of ₱${amount} for booking ${booking.referenceNumber} has been processed.`);
    res.json({ success: true, booking: await withRefs(Booking.findById(booking._id)) });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-123 Transaction History                                          */
/* ------------------------------------------------------------------ */
router.get('/transactions', authorize('payments'), async (req, res) => {
  try {
    const { page, limit, skip } = pageOf(req, 20);
    const filter = {};
    if (['payment', 'refund', 'failed'].includes(req.query.type)) filter.type = req.query.type;
    if (U.isDateStr(req.query.from) || U.isDateStr(req.query.to)) {
      filter.createdAt = {};
      if (U.isDateStr(req.query.from)) filter.createdAt.$gte = U.manilaMidnight(req.query.from);
      if (U.isDateStr(req.query.to)) filter.createdAt.$lt = new Date(U.manilaMidnight(req.query.to).getTime() + 864e5);
    }
    if (req.query.q) {
      const safe = escapeRegex(req.query.q);
      const people = await User.find({ $or: ['firstName', 'lastName', 'email'].map((f) => ({ [f]: { $regex: safe, $options: 'i' } })) }).select('_id').limit(100);
      filter.$or = [{ referenceNumber: { $regex: safe, $options: 'i' } }, { user: { $in: people.map((p) => p._id) } }];
    }
    const [total, items, sums] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'firstName lastName email').populate('recordedBy', 'firstName lastName'),
      Transaction.aggregate([{ $match: filter }, { $group: { _id: '$type', amount: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    ]);
    const totals = { payment: 0, refund: 0, failed: 0 };
    sums.forEach((s) => { totals[s._id] = s.amount; });
    res.json({ success: true, ...paged(total, page, limit), transactions: items, totals });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-124 Customer Booking History                                     */
/* ------------------------------------------------------------------ */
router.get('/users/:id/bookings', authorize('users', 'bookings'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return bad(res, 'Account not found', 404);
    const bookings = await Booking.find({ user: user._id }).sort({ date: -1, startTime: -1 }).limit(300);
    const totals = { count: bookings.length, completed: 0, cancelled: 0, upcoming: 0, spent: 0 };
    const now = new Date();
    bookings.forEach((b) => {
      if (b.status === 'completed') totals.completed += 1;
      if (b.status === 'cancelled' || b.status === 'rejected') totals.cancelled += 1;
      if (['pending', 'confirmed'].includes(b.status) && U.endInstant(b) > now) totals.upcoming += 1;
      if (b.paymentStatus === 'paid') totals.spent += b.totalFee;
    });
    res.json({
      success: true,
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, isActive: user.isActive, createdAt: user.createdAt },
      totals, bookings,
    });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-125 Notifications Management                                     */
/* ------------------------------------------------------------------ */
router.post('/notifications', authorize('notifications'), async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return bad(res, 'Write a message to send');
    if (message.length > 300) return bad(res, 'Keep the message under 300 characters');
    const audience = req.body.audience;
    let recipients = [];
    if (audience === 'user') {
      if (!mongoose.isValidObjectId(req.body.userId)) return bad(res, 'Choose a customer');
      const u = await User.findById(req.body.userId);
      if (!u || u.role !== 'user') return bad(res, 'Customer not found', 404);
      recipients = [u._id];
    } else if (audience === 'upcoming') {
      const open = await Booking.find({ status: { $in: ['pending', 'confirmed'] }, date: { $gte: U.manilaMidnight(U.todayStr()) } }).distinct('user');
      recipients = open;
    } else if (audience === 'all') {
      recipients = await User.find({ role: 'user', isActive: true }).distinct('_id');
    } else return bad(res, 'Choose who to send this to');
    if (!recipients.length) return bad(res, 'No customers match that audience');

    const batch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await Notification.insertMany(recipients.map((user) => ({ user, message, sentBy: req.user._id, batch })));
    res.status(201).json({ success: true, sent: recipients.length });
  } catch (err) { handleError(res, err); }
});

router.get('/notifications', authorize('notifications'), async (req, res) => {
  try {
    const rows = await Notification.aggregate([
      { $match: { batch: { $exists: true, $ne: null } } },
      { $group: { _id: '$batch', message: { $first: '$message' }, sentBy: { $first: '$sentBy' }, at: { $max: '$createdAt' }, recipients: { $sum: 1 }, read: { $sum: { $cond: ['$read', 1, 0] } } } },
      { $sort: { at: -1 } }, { $limit: 40 },
    ]);
    const senders = await User.find({ _id: { $in: rows.map((r) => r.sentBy).filter(Boolean) } }).select('firstName lastName');
    const nameOf = Object.fromEntries(senders.map((s) => [String(s._id), `${s.firstName} ${s.lastName}`]));
    res.json({ success: true, sent: rows.map((r) => ({ id: r._id, message: r.message, at: r.at, recipients: r.recipients, read: r.read, sentBy: nameOf[String(r.sentBy)] || 'Admin' })) });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-126 Announcements Management                                     */
/* ------------------------------------------------------------------ */
router.get('/announcements', authorize('announcements'), async (req, res) => {
  try {
    res.json({ success: true, announcements: await Announcement.find().sort({ createdAt: -1 }).limit(100) });
  } catch (err) { handleError(res, err); }
});
router.post('/announcements', authorize('announcements'), async (req, res) => {
  try {
    const published = req.body.published === true || req.body.published === 'true';
    const a = await Announcement.create({
      title: req.body.title, body: req.body.body, published, publishedAt: published ? new Date() : undefined, createdBy: req.user._id,
    });
           if (published) await announceCustomers(a, req.user._id);
    res.status(201).json({ success: true, announcement: a });
  } catch (err) { handleError(res, err); }
});
router.put('/announcements/:id', authorize('announcements'), async (req, res) => {
  try {
    const a = await Announcement.findById(req.params.id);
    if (!a) return bad(res, 'Announcement not found', 404);
    if (req.body.title !== undefined) a.title = req.body.title;
    if (req.body.body !== undefined) a.body = req.body.body;
    await a.save();
    res.json({ success: true, announcement: a });
  } catch (err) { handleError(res, err); }
});
router.patch('/announcements/:id/publish', authorize('announcements'), async (req, res) => {
  try {
    const a = await Announcement.findById(req.params.id);
    if (!a) return bad(res, 'Announcement not found', 404);
           const wasPublished = a.published;
       a.published = req.body.published === true || req.body.published === 'true';
       if (a.published) a.publishedAt = new Date();
       await a.save();
       if (a.published && !wasPublished) await announceCustomers(a, req.user._id);
    res.json({ success: true, announcement: a });
  } catch (err) { handleError(res, err); }
});
router.delete('/a.publishedannouncements/:id', authorize('announcements'), async (req, res) => {
  try {
    const a = await Announcement.findByIdAndDelete(req.params.id);
    if (!a) return bad(res, 'Announcement not found', 404);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-127 Promotions and Discounts                                     */
/* ------------------------------------------------------------------ */
function promoFields(body) {
  const out = {};
  ['code', 'title', 'description', 'type'].forEach((k) => { if (body[k] !== undefined) out[k] = body[k]; });
  if (body.value !== undefined) out.value = Number(body.value);
  if (body.usageLimit !== undefined) out.usageLimit = Math.max(Number(body.usageLimit) || 0, 0);
  if (body.startsAt !== undefined) out.startsAt = U.isDateStr(body.startsAt) ? U.manilaMidnight(body.startsAt) : undefined;
  if (body.endsAt !== undefined) out.endsAt = U.isDateStr(body.endsAt) ? new Date(U.manilaMidnight(body.endsAt).getTime() + 864e5 - 1) : undefined;
  return out;
}
router.get('/promotions', authorize('promotions'), async (req, res) => {
  try {
    res.json({ success: true, promotions: await Promotion.find().sort({ createdAt: -1 }).limit(200) });
  } catch (err) { handleError(res, err); }
});
router.post('/promotions', authorize('promotions'), async (req, res) => {
  try {
    const f = promoFields(req.body);
    if (f.startsAt && f.endsAt && f.startsAt > f.endsAt) return bad(res, 'The end date must be after the start date');
    res.status(201).json({ success: true, promotion: await Promotion.create(f) });
  } catch (err) { handleError(res, err); }
});
router.put('/promotions/:id', authorize('promotions'), async (req, res) => {
  try {
    const p = await Promotion.findById(req.params.id);
    if (!p) return bad(res, 'Promotion not found', 404);
    Object.assign(p, promoFields(req.body));
    if (p.startsAt && p.endsAt && p.startsAt > p.endsAt) return bad(res, 'The end date must be after the start date');
    await p.save();
    res.json({ success: true, promotion: p });
  } catch (err) { handleError(res, err); }
});
router.patch('/promotions/:id/active', authorize('promotions'), async (req, res) => {
  try {
    const p = await Promotion.findById(req.params.id);
    if (!p) return bad(res, 'Promotion not found', 404);
    p.active = req.body.active === true || req.body.active === 'true';
    await p.save();
    res.json({ success: true, promotion: p });
  } catch (err) { handleError(res, err); }
});
router.delete('/promotions/:id', authorize('promotions'), async (req, res) => {
  try {
    const p = await Promotion.findByIdAndDelete(req.params.id);
    if (!p) return bad(res, 'Promotion not found', 404);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-128 Feedback Management                                          */
/* ------------------------------------------------------------------ */
router.get('/feedback', authorize('feedback'), async (req, res) => {
  try {
    const { page, limit, skip } = pageOf(req, 15);
    const filter = {};
    if (['new', 'reviewed', 'hidden'].includes(req.query.status)) filter.status = req.query.status;
    const r = Number(req.query.rating);
    if (r >= 1 && r <= 5) filter.rating = r;
    const [total, items, agg, dist] = await Promise.all([
      Feedback.countDocuments(filter),
      Feedback.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'firstName lastName email').populate('booking', 'referenceNumber date startTime'),
      Feedback.aggregate([{ $match: { status: { $ne: 'hidden' } } }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]),
      Feedback.aggregate([{ $match: { status: { $ne: 'hidden' } } }, { $group: { _id: '$rating', n: { $sum: 1 } } }]),
    ]);
    const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    dist.forEach((d) => { stars[d._id] = d.n; });
    res.json({ success: true, ...paged(total, page, limit), feedback: items, average: agg[0] ? Math.round(agg[0].avg * 10) / 10 : 0, count: agg[0] ? agg[0].n : 0, stars });
  } catch (err) { handleError(res, err); }
});
router.patch('/feedback/:id', authorize('feedback'), async (req, res) => {
  try {
    if (!['new', 'reviewed', 'hidden'].includes(req.body.status)) return bad(res, 'Invalid status');
    const f = await Feedback.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!f) return bad(res, 'Feedback not found', 404);
    res.json({ success: true, feedback: f });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-129 Complaint / Issue Management                                 */
/* ------------------------------------------------------------------ */
router.get('/issues', authorize('issues'), async (req, res) => {
  try {
    const filter = {};
    if (['open', 'in_progress', 'resolved'].includes(req.query.status)) filter.status = req.query.status;
    const [issues, counts] = await Promise.all([
      Issue.find(filter).sort({ updatedAt: -1 }).limit(100).populate('user', 'firstName lastName email phone').populate('booking', 'referenceNumber courtName date startTime'),
      Issue.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const c = { open: 0, in_progress: 0, resolved: 0 };
    counts.forEach((x) => { c[x._id] = x.n; });
    res.json({ success: true, issues, counts: c });
  } catch (err) { handleError(res, err); }
});
router.post('/issues/:id/reply', authorize('issues'), async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return bad(res, 'Write a reply first');
    const issue = await Issue.findById(req.params.id);
    if (!issue) return bad(res, 'Issue not found', 404);
    issue.replies.push({ by: req.user._id, byRole: req.user.role, byName: `${req.user.firstName} ${req.user.lastName}`, message: message.slice(0, 2000) });
    if (['open', 'in_progress', 'resolved'].includes(req.body.status)) issue.status = req.body.status;
    else if (issue.status === 'open') issue.status = 'in_progress';
    await issue.save();
    await U.notify(issue.user, `The facility replied to your report "${issue.subject}".`);
    res.json({ success: true, issue });
  } catch (err) { handleError(res, err); }
});
router.patch('/issues/:id', authorize('issues'), async (req, res) => {
  try {
    if (!['open', 'in_progress', 'resolved'].includes(req.body.status)) return bad(res, 'Invalid status');
    const issue = await Issue.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!issue) return bad(res, 'Issue not found', 404);
    if (req.body.status === 'resolved') await U.notify(issue.user, `Your report "${issue.subject}" was marked resolved.`);
    res.json({ success: true, issue });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-130 Check-in Management                                          */
/* ------------------------------------------------------------------ */
router.get('/checkins', authorize('checkins'), async (req, res) => {
  try {
    const date = U.isDateStr(req.query.date) ? req.query.date : U.todayStr();
    await U.autoCompleteBookings();
    const bookings = await withRefs(Booking.find({ date: U.manilaMidnight(date), status: { $in: ['confirmed', 'completed'] } }).sort({ startTime: 1 }));
    res.json({ success: true, date, bookings });
  } catch (err) { handleError(res, err); }
});
router.patch('/bookings/:id/checkin', authorize('checkins'), async (req, res) => {
  try {
    const action = req.body.action;
    if (!['in', 'out', 'undo'].includes(action)) return bad(res, 'Invalid action');
    const booking = await Booking.findById(req.params.id);
    if (!booking) return bad(res, 'Booking not found', 404);
    if (!['confirmed', 'completed'].includes(booking.status)) return bad(res, 'Only confirmed bookings can be checked in');
    if (U.toDateStr(booking.date) !== U.todayStr() && action !== 'undo') return bad(res, 'Check-in is only available on the booking date');
    if (action === 'in') {
      if (booking.checkedInAt) return bad(res, 'Already checked in');
      booking.checkedInAt = new Date();
    } else if (action === 'out') {
      if (!booking.checkedInAt) return bad(res, 'Check the customer in first');
      if (booking.checkedOutAt) return bad(res, 'Already checked out');
      booking.checkedOutAt = new Date();
    } else {
      booking.checkedOutAt = booking.checkedOutAt ? undefined : booking.checkedOutAt;
      if (!req.body.keepIn) booking.checkedInAt = undefined;
    }
    await booking.save();
    res.json({ success: true, booking: await withRefs(Booking.findById(booking._id)) });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-132 Booking Analytics                                            */
/* ------------------------------------------------------------------ */
router.get('/analytics/bookings', authorize('analytics'), async (req, res) => {
  try {
    const r = range(req);
    if (!r) return badRange(res);
    const list = await Booking.find({ date: { $gte: r.gte, $lt: r.lt } }).select('date startTime status courtName totalFee').lean();
    const live = list.filter((b) => !dead(b));
    const perDay = Object.fromEntries(dayList(r).map((d) => [d, 0]));
    live.forEach((b) => { const d = U.toDateStr(b.date); if (d in perDay) perDay[d] += 1; });
    const byCourt = {}; const hours = {};
    live.forEach((b) => {
      byCourt[b.courtName] = (byCourt[b.courtName] || 0) + 1;
      const h = b.startTime.slice(0, 2);
      hours[h] = (hours[h] || 0) + 1;
    });
    const cancelled = list.filter((b) => b.status === 'cancelled').length;
    const rejected = list.filter((b) => b.status === 'rejected').length;
    res.json({
      success: true, from: r.from, to: r.to,
      totals: { all: list.length, active: live.length, cancelled, rejected, cancellationRate: list.length ? Math.round(((cancelled + rejected) / list.length) * 1000) / 10 : 0 },
      perDay: Object.entries(perDay).map(([date, count]) => ({ date, count })),
      byCourt: Object.entries(byCourt).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      peakHours: Object.entries(hours).map(([hour, count]) => ({ hour: `${hour}:00`, count })).sort((a, b) => a.hour.localeCompare(b.hour)),
    });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-133 Revenue Analytics                                            */
/* ------------------------------------------------------------------ */
router.get('/analytics/revenue', authorize('analytics'), async (req, res) => {
  try {
    const r = range(req);
    if (!r) return badRange(res);
    const when = { $gte: r.gte, $lt: r.lt };
    const [pay, refunds, outstanding] = await Promise.all([
      Transaction.find({ type: 'payment', createdAt: when }).lean(),
      Transaction.find({ type: 'refund', createdAt: when }).lean(),
      Booking.find({ paymentStatus: 'pending', status: { $in: ['pending', 'confirmed', 'completed'] }, date: { $gte: r.gte, $lt: r.lt } }).select('totalFee').lean(),
    ]);
    const perDay = Object.fromEntries(dayList(r).map((d) => [d, 0]));
    const byCourt = {}; const byMethod = {};
    pay.forEach((t) => {
      const d = U.toDateStr(t.createdAt); if (d in perDay) perDay[d] += t.amount;
      byCourt[t.courtName || 'Unknown'] = (byCourt[t.courtName || 'Unknown'] || 0) + t.amount;
      byMethod[t.method || 'Not recorded'] = (byMethod[t.method || 'Not recorded'] || 0) + t.amount;
    });
    const gross = pay.reduce((s, t) => s + t.amount, 0);
    const refunded = refunds.reduce((s, t) => s + t.amount, 0);
    res.json({
      success: true, from: r.from, to: r.to,
      totals: { gross, refunded, net: gross - refunded, payments: pay.length, average: pay.length ? Math.round(gross / pay.length) : 0, outstanding: outstanding.reduce((s, b) => s + b.totalFee, 0) },
      perDay: Object.entries(perDay).map(([date, amount]) => ({ date, amount })),
      byCourt: Object.entries(byCourt).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
      byMethod: Object.entries(byMethod).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-134 User Analytics                                               */
/* ------------------------------------------------------------------ */
router.get('/analytics/users', authorize('analytics'), async (req, res) => {
  try {
    const r = range(req);
    if (!r) return badRange(res);
    const [total, active, inactive, joined, inRange, allTime] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', isActive: true }),
      User.countDocuments({ role: 'user', isActive: false }),
      User.find({ role: 'user', createdAt: { $gte: r.gte, $lt: r.lt } }).select('createdAt').lean(),
      Booking.find({ date: { $gte: r.gte, $lt: r.lt }, status: { $in: U.ACTIVE_STATUSES } }).select('user totalFee paymentStatus').lean(),
      Booking.aggregate([{ $match: { status: { $in: U.ACTIVE_STATUSES } } }, { $group: { _id: '$user', n: { $sum: 1 } } }]),
    ]);
    const perDay = Object.fromEntries(dayList(r).map((d) => [d, 0]));
    joined.forEach((u) => { const d = U.toDateStr(u.createdAt); if (d in perDay) perDay[d] += 1; });
    const per = {};
    inRange.forEach((b) => {
      const k = String(b.user);
      per[k] = per[k] || { n: 0, spent: 0 };
      per[k].n += 1;
      if (b.paymentStatus === 'paid') per[k].spent += b.totalFee;
    });
    const top = Object.entries(per).sort((a, b) => b[1].n - a[1].n || b[1].spent - a[1].spent).slice(0, 5);
    const people = await User.find({ _id: { $in: top.map(([id]) => id) } }).select('firstName lastName email');
    const nameOf = Object.fromEntries(people.map((p) => [String(p._id), p]));
    res.json({
      success: true, from: r.from, to: r.to,
      totals: {
        total, active, inactive, newUsers: joined.length, activeBookers: Object.keys(per).length,
        bookings: inRange.length, repeatCustomers: allTime.filter((x) => x.n > 1).length, neverBooked: Math.max(total - allTime.length, 0),
      },
      perDay: Object.entries(perDay).map(([date, count]) => ({ date, count })),
      top: top.map(([id, v]) => ({ name: nameOf[id] ? `${nameOf[id].firstName} ${nameOf[id].lastName}` : 'Deleted user', email: nameOf[id] ? nameOf[id].email : '', bookings: v.n, spent: v.spent })),
    });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-131 Reports                                                      */
/* ------------------------------------------------------------------ */
const REPORTS = ['bookings', 'users', 'courts', 'payments', 'transactions'];
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;
const stamp = (d) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });

router.get('/reports/:type', authorize('reports'), async (req, res) => {
  try {
    const type = req.params.type;
    if (!REPORTS.includes(type)) return bad(res, 'Unknown report', 404);
    const r = range(req);
    if (!r) return badRange(res);
    let report;

    if (type === 'bookings' || type === 'payments') {
      const list = await Booking.find({ date: { $gte: r.gte, $lt: r.lt } }).sort({ date: 1, startTime: 1 }).populate('user', 'firstName lastName').lean();
      const name = (b) => (b.user ? `${b.user.firstName} ${b.user.lastName}` : 'Deleted user');
      if (type === 'bookings') {
        report = {
          title: 'Bookings report',
          columns: ['Reference', 'Customer', 'Court', 'Date', 'Time', 'Status', 'Fee'],
          rows: list.map((b) => [b.referenceNumber, name(b), b.courtName, U.toDateStr(b.date), `${b.startTime}-${b.endTime}`, b.status, peso(b.totalFee)]),
          summary: [
            { label: 'Bookings', value: list.length },
            ...['pending', 'confirmed', 'completed', 'cancelled', 'rejected'].map((s) => ({ label: s[0].toUpperCase() + s.slice(1), value: list.filter((b) => b.status === s).length })),
          ],
        };
      } else {
        const live = list.filter((b) => !dead(b) || ['paid', 'refunded'].includes(b.paymentStatus));
        const sum = (st) => live.filter((b) => b.paymentStatus === st).reduce((s, b) => s + b.totalFee, 0);
        report = {
          title: 'Payments report',
          columns: ['Reference', 'Customer', 'Date', 'Method', 'Payment status', 'Amount'],
          rows: live.map((b) => [b.referenceNumber, name(b), U.toDateStr(b.date), b.paymentMethod || '-', b.paymentStatus, peso(b.totalFee)]),
          summary: [{ label: 'Paid', value: peso(sum('paid')) }, { label: 'Unpaid', value: peso(sum('pending')) }, { label: 'Failed', value: peso(sum('failed')) }, { label: 'Refunded', value: peso(sum('refunded')) }],
        };
      }
    } else if (type === 'users') {
      const users = await User.find({ role: 'user', createdAt: { $gte: r.gte, $lt: r.lt } }).sort({ createdAt: 1 }).lean();
      const counts = await Booking.aggregate([{ $match: { user: { $in: users.map((u) => u._id) }, status: { $in: U.ACTIVE_STATUSES } } }, { $group: { _id: '$user', n: { $sum: 1 } } }]);
      const n = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
      report = {
        title: 'New customers report',
        columns: ['Name', 'Email', 'Phone', 'Joined', 'Status', 'Bookings'],
        rows: users.map((u) => [`${u.firstName} ${u.lastName}`, u.email, u.phone || '-', U.toDateStr(u.createdAt), u.isActive === false ? 'Deactivated' : 'Active', n[String(u._id)] || 0]),
        summary: [{ label: 'New customers', value: users.length }, { label: 'Deactivated', value: users.filter((u) => u.isActive === false).length }],
      };
    } else if (type === 'courts') {
      const [courts, bks] = await Promise.all([
        Court.find().sort({ name: 1 }).lean(),
        Booking.find({ date: { $gte: r.gte, $lt: r.lt }, status: { $in: U.ACTIVE_STATUSES } }).select('court totalFee paymentStatus').lean(),
      ]);
      const by = {};
      bks.forEach((b) => { const k = String(b.court); by[k] = by[k] || { n: 0, rev: 0 }; by[k].n += 1; if (b.paymentStatus === 'paid') by[k].rev += b.totalFee; });
      report = {
        title: 'Courts report',
        columns: ['Court', 'Location', 'Status', 'Price / hour', 'Bookings', 'Revenue'],
        rows: courts.map((c) => [c.name, c.location, c.status, peso(c.pricePerHour), (by[String(c._id)] || { n: 0 }).n, peso((by[String(c._id)] || { rev: 0 }).rev)]),
        summary: [{ label: 'Courts', value: courts.length }, { label: 'Bookings in range', value: bks.length }],
      };
    } else {
      const tx = await Transaction.find({ createdAt: { $gte: r.gte, $lt: r.lt } }).sort({ createdAt: 1 }).lean();
      const sum = (t) => tx.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0);
      report = {
        title: 'Transactions report',
        columns: ['When', 'Reference', 'Type', 'Method', 'Amount', 'Note'],
        rows: tx.map((t) => [stamp(t.createdAt), t.referenceNumber, t.type, t.method || '-', peso(t.amount), t.note || '']),
        summary: [{ label: 'Payments', value: peso(sum('payment')) }, { label: 'Refunds', value: peso(sum('refund')) }, { label: 'Net', value: peso(sum('payment') - sum('refund')) }],
      };
    }
    res.json({ success: true, from: r.from, to: r.to, truncated: report.rows.length > 2000, ...report, rows: report.rows.slice(0, 2000) });
  } catch (err) { handleError(res, err); }
});

/* ------------------------------------------------------------------ */
/* AF-135 Audit Logs                                                   */
/* ------------------------------------------------------------------ */
router.get('/audit', authorize('audit'), async (req, res) => {
  try {
    const { page, limit, skip } = pageOf(req, 25);
    const filter = {};
    if (req.query.q) {
      const safe = escapeRegex(req.query.q);
      filter.$or = ['actorName', 'action', 'detail', 'ip'].map((f) => ({ [f]: { $regex: safe, $options: 'i' } }));
    }
    if (U.isDateStr(req.query.date)) filter.createdAt = { $gte: U.manilaMidnight(req.query.date), $lt: new Date(U.manilaMidnight(req.query.date).getTime() + 864e5) };
    const [total, logs] = await Promise.all([AuditLog.countDocuments(filter), AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)]);
    res.json({ success: true, ...paged(total, page, limit), logs });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
