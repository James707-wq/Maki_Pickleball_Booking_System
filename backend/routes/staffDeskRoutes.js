/**
 * Staff desk screens. Mounted inside adminRoutes (console session needed).
 *   GET /api/admin/board?for=staff|customers       SF-128 published announcements and staff instructions (read only)
 *   GET /api/admin/activity?q=&date=&page=          SF-135 my own actions (the audit log, for me)
 *   GET /api/admin/day-report?date=&format=csv      SF-131 the day's reservations; SF-133 court usage hour by hour
 *   GET /api/admin/shift-payments?date=&from=&to=&mine=1   SF-132 payments taken during a shift (default: my shift), by staff member
 */
const express = require('express');
const Announcement = require('../models/Announcement');
const AuditLog = require('../models/AuditLog');
const Booking = require('../models/Booking');
const BlockedSlot = require('../models/BlockedSlot');
const Court = require('../models/Court');
const Shift = require('../models/Shift');
const Transaction = require('../models/Transaction');
const { authorize } = require('../middleware/auth');
const { can } = require('../config/permissions');
const U = require('../utils/bookingUtils');
const CSV = require('../utils/csv');
const handleError = require('../utils/handleError');
const { pickShift } = require('./shiftRoutes');

const router = express.Router();
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const escapeRegex = (s) => String(s).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameOf = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
const nowMinutes = () => U.toMinutes(new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16));
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_RE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/* ---------- SF-128 Announcements and staff instructions ---------- */
router.get('/board', authorize('announcements.view', 'announcements'), async (req, res) => {
  try {
    const filter = { published: true };
    if (req.query.for === 'staff') filter.audience = { $in: ['staff', 'everyone'] };
    if (req.query.for === 'customers') filter.audience = { $in: ['customers', 'everyone', null] };
    const items = await Announcement.find(filter).sort({ publishedAt: -1 }).limit(60).populate('createdBy', 'firstName lastName').lean();
    res.json({ success: true, announcements: items.map((a) => ({
      _id: a._id, title: a.title, body: a.body, audience: a.audience || 'customers', publishedAt: a.publishedAt, by: nameOf(a.createdBy) || 'Admin',
    })) });
  } catch (err) { handleError(res, err); }
});

/* ---------- SF-135 My activity ---------- */
router.get('/activity', authorize('dashboard'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const filter = { actor: req.user._id };
    if (req.query.q) {
      const re = { $regex: escapeRegex(req.query.q), $options: 'i' };
      filter.$or = [{ action: re }, { detail: re }];
    }
    if (U.isDateStr(req.query.date)) {
      const start = U.manilaMidnight(req.query.date);
      filter.createdAt = { $gte: start, $lt: new Date(start.getTime() + 864e5) };
    }
    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('createdAt action detail ip').lean(),
    ]);
    res.json({ success: true, total, page, pages: Math.max(Math.ceil(total / limit), 1), logs });
  } catch (err) { handleError(res, err); }
});

/* ---------- SF-131 Daily booking report, SF-133 Court utilization ---------- */
router.get('/day-report', authorize('reports.daily'), async (req, res) => {
  try {
    await U.autoCompleteBookings();
    const today = U.todayStr();
    const date = U.isDateStr(req.query.date) ? req.query.date : today;
    const day = U.manilaMidnight(date);
    const [all, courts, blocks] = await Promise.all([
      Booking.find({ date: day }).sort({ startTime: 1, courtName: 1 }).populate('user', 'firstName lastName phone').lean(),
      Court.find().sort({ name: 1 }).lean(),
      BlockedSlot.find({ date: day }).lean(),
    ]);
    const active = all.filter((b) => U.ACTIVE_STATUSES.includes(b.status));
    const now = new Date();
    const ended = (b) => U.endInstant(b) <= now;
    const m = (t) => U.toMinutes(t);
    const count = (list, fn) => list.filter(fn).length;
    const sum = (list) => list.reduce((s, b) => s + (b.totalFee || 0), 0);

    if (req.query.format === 'csv') {
      return CSV.send(res, `Daily report ${date}`,
        ['Time', 'Court', 'Reference', 'Customer', 'Mobile', 'Booked', 'Status', 'Payment', 'Fee (PHP)', 'Checked in', 'Checked out'],
        all.map((b) => [`${b.startTime}-${b.endTime}`, b.courtName, b.referenceNumber, U.customerName(b),
          b.user ? b.user.phone || '' : (b.walkIn && b.walkIn.phone) || '', b.source === 'desk' ? 'At the desk' : 'Online',
          b.status, b.paymentStatus, b.totalFee, b.checkedInAt || '', b.checkedOutAt || '']));
    }

    const totals = {
      bookings: active.length,
      pending: count(active, (b) => b.status === 'pending'),
      confirmed: count(active, (b) => b.status === 'confirmed'),
      completed: count(active, (b) => b.status === 'completed'),
      cancelled: count(all, (b) => b.status === 'cancelled'),
      rejected: count(all, (b) => b.status === 'rejected'),
      online: count(active, (b) => b.source !== 'desk'),
      desk: count(active, (b) => b.source === 'desk'),
      checkedIn: count(active, (b) => b.checkedInAt),
      onCourt: count(active, (b) => b.checkedInAt && !b.checkedOutAt),
      finished: count(active, (b) => b.checkedOutAt),
      waiting: count(active, (b) => b.status === 'confirmed' && !b.checkedInAt && !ended(b)),
      notArrived: count(active, (b) => b.status !== 'pending' && !b.checkedInAt && ended(b)),
      hoursBooked: Math.round(active.reduce((s, b) => s + m(b.endTime) - m(b.startTime), 0) / 6) / 10,
    };
    // money only for those who handle payments; a single day is within what staff may see
    const money = can(req.user.role, 'payments') ? {
      paid: sum(active.filter((b) => b.paymentStatus === 'paid')),
      due: sum(active.filter((b) => ['pending', 'failed'].includes(b.paymentStatus))),
      refunded: all.filter((b) => b.paymentStatus === 'refunded').reduce((s, b) => s + ((b.refund && b.refund.amount) || b.totalFee || 0), 0),
    } : null;

    // court usage, hour by hour, between the earliest opening and the latest closing of the courts in use
    const open = courts.filter((c) => c.status === 'available');
    const first = open.length ? Math.min(...open.map((c) => m(c.openTime))) : 6 * 60;
    const last = open.length ? Math.max(...open.map((c) => m(c.closeTime))) : 22 * 60;
    const hours = [];
    for (let h = Math.floor(first / 60) * 60; h < last; h += 60) hours.push(h);
    const nowMin = date === today ? nowMinutes() : date < today ? 24 * 60 : -1;
    let capacity = 0;
    let used = 0;
    const courtRows = courts.map((c) => {
      const mine = active.filter((b) => String(b.court) === String(c._id));
      const blocked = blocks.filter((k) => String(k.court) === String(c._id));
      const isOpen = c.status === 'available';
      const openM = isOpen ? m(c.closeTime) - m(c.openTime) : 0;
      const blockedM = isOpen ? blocked.reduce((s, k) => s + m(k.endTime) - m(k.startTime), 0) : 0;
      const bookedM = mine.reduce((s, b) => s + m(b.endTime) - m(b.startTime), 0);
      const cap = Math.max(openM - blockedM, 0);
      capacity += cap;
      used += isOpen ? Math.min(bookedM, cap) : 0;
      const cells = hours.map((h) => {
        const e = h + 60;
        if (!isOpen || e <= m(c.openTime) || h >= m(c.closeTime)) return { state: 'closed' };
        const b = mine.find((x) => m(x.startTime) < e && m(x.endTime) > h);
        if (b) {
          return { state: 'booked', id: b._id, ref: b.referenceNumber, customer: U.customerName(b), status: b.status, start: b.startTime, end: b.endTime,
            checkedIn: Boolean(b.checkedInAt && !b.checkedOutAt), finished: Boolean(b.checkedOutAt) };
        }
        const k = blocked.find((x) => m(x.startTime) < e && m(x.endTime) > h);
        if (k) return { state: 'blocked', reason: k.reason || '' };
        return { state: e <= nowMin ? 'past' : 'free' };
      });
      return { id: c._id, name: c.name, status: c.status, openTime: c.openTime, closeTime: c.closeTime, bookings: mine.length,
        hoursBooked: Math.round(bookedM / 6) / 10, hoursOpen: Math.round(cap / 6) / 10, usage: cap ? Math.min(bookedM / cap, 1) : null, cells };
    });
    const byHour = hours.map((h, i) => {
      const states = courtRows.map((c) => c.cells[i].state);
      return { hour: hhmm(h), booked: states.filter((s) => s === 'booked').length, open: states.filter((s) => s !== 'closed' && s !== 'blocked').length };
    });
    const busiest = byHour.filter((x) => x.booked).sort((a, b) => b.booked - a.booked || a.hour.localeCompare(b.hour)).slice(0, 3);

    res.json({ success: true, date, today, now: date === today ? hhmm(nowMin) : null, generatedAt: now, totals, money,
      usage: { overall: capacity ? used / capacity : null, hoursOpen: Math.round(capacity / 6) / 10, hoursBooked: Math.round(used / 6) / 10 },
      hours: hours.map(hhmm), courts: courtRows, byHour, busiest,
      bookings: all.map((b) => ({ _id: b._id, referenceNumber: b.referenceNumber, courtName: b.courtName, startTime: b.startTime, endTime: b.endTime,
        customer: U.customerName(b), source: b.source || 'online', status: b.status, paymentStatus: b.paymentStatus, totalFee: b.totalFee,
        checkedInAt: b.checkedInAt || null, checkedOutAt: b.checkedOutAt || null })) });
  } catch (err) { handleError(res, err); }
});

/* ---------- SF-132 Payment report for a shift ---------- */
router.get('/shift-payments', authorize('payments'), async (req, res) => {
  try {
    const today = U.todayStr();
    const date = U.isDateStr(req.query.date) ? req.query.date : today;
    let from = TIME_RE.test(req.query.from || '') ? req.query.from : null;
    let to = END_RE.test(req.query.to || '') ? req.query.to : null;
    let shift = null;
    if (!from && !to) { // my shift that day (the one being worked now, on today)
      const mine = await Shift.find({ user: req.user._id, date: U.manilaMidnight(date) }).sort({ startTime: 1 }).lean();
      shift = date === today ? pickShift(mine, nowMinutes()) : mine[0] || null;
      if (shift) ({ startTime: from, endTime: to } = shift);
    }
    from = from || '00:00';
    to = to || '24:00';
    if (to <= from) return bad(res, 'The end of the shift must be after its start');
    const start = new Date(U.manilaMidnight(date).getTime() + U.toMinutes(from) * 60000);
    const end = new Date(U.manilaMidnight(date).getTime() + U.toMinutes(to) * 60000);
    const filter = { createdAt: { $gte: start, $lt: end } };
    const mineOnly = req.query.mine === '1';
    if (mineOnly) filter.recordedBy = req.user._id;
    const rows = await Transaction.find(filter).sort({ createdAt: 1 }).populate('recordedBy', 'firstName lastName').populate('user', 'firstName lastName').lean();

    const byStaff = {};
    const totals = { received: 0, refunded: 0, net: 0, payments: 0, refunds: 0, failed: 0 };
    rows.forEach((t) => {
      const sign = t.type === 'payment' ? 1 : t.type === 'refund' ? -1 : 0;
      const who = nameOf(t.recordedBy) || 'Online (automatic)';
      const g = byStaff[who] || (byStaff[who] = { name: who, received: 0, refunded: 0, net: 0, count: 0 });
      if (t.type === 'payment') g.received += t.amount;
      if (t.type === 'refund') g.refunded += t.amount;
      g.net += sign * t.amount;
      g.count += 1;
      if (t.type === 'payment') { totals.received += t.amount; totals.payments += 1; }
      if (t.type === 'refund') { totals.refunded += t.amount; totals.refunds += 1; }
      if (t.type === 'failed') totals.failed += 1;
    });
    totals.net = totals.received - totals.refunded;
    res.json({ success: true, date, from, to, mine: mineOnly,
      shift: shift ? { startTime: shift.startTime, endTime: shift.endTime, note: shift.note || '' } : null,
      totals, byStaff: Object.values(byStaff).sort((a, b) => b.net - a.net),
      transactions: rows.map((t) => ({ _id: t._id, at: t.createdAt, type: t.type, amount: t.amount, referenceNumber: t.referenceNumber,
        courtName: t.courtName, customer: t.user ? nameOf(t.user) : t.customerName ? `${t.customerName} (walk-in)` : 'Deleted user', note: t.note || '',
        recordedBy: nameOf(t.recordedBy) })) });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
