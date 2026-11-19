/**
 * SF-134 Shift Information. Mounted inside adminRoutes; writes are audit-logged.
 *   GET    /api/admin/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD   admins: everyone's shifts (default: this week) + the team
 *   POST   /api/admin/shifts                                   admins: assign a shift (the staff member is told)
 *   PUT    /api/admin/shifts/:id                               admins: change it
 *   DELETE /api/admin/shifts/:id                               admins: remove it
 *   GET    /api/admin/shifts/mine                              staff: my shift now, today and the coming weeks
 */
const express = require('express');
const mongoose = require('mongoose');
const Shift = require('../models/Shift');
const User = require('../models/User');
const { authorize } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const U = require('../utils/bookingUtils');
const C = require('../utils/concurrency');
const handleError = require('../utils/handleError');

const router = express.Router();
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const START_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_RE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const nameOf = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();
const addDays = (str, n) => U.toDateStr(new Date(U.manilaMidnight(str).getTime() + n * 864e5));
const dayLabel = (d) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' });
const shiftLabel = (s) => `${dayLabel(s.date)}, ${s.startTime}–${s.endTime}${s.note ? ` (${s.note})` : ''}`;
const nowMinutes = () => U.toMinutes(new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16));
const LINK = { link: '#/myshifts' };
const CONSOLE_ROLES = Object.keys(PERMISSIONS).filter((r) => r !== 'user' && PERMISSIONS[r].includes('dashboard'));

/** Monday..Sunday of the week holding `str` (Manila calendar). */
function weekOf(str) {
  const [y, m, d] = str.split('-').map(Number);
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const from = addDays(str, -back);
  return { from, to: addDays(from, 6) };
}

/** Checks a shift from the request body; returns { error } or the clean values. */
async function readShift(req, exceptId) {
  const { userId, date } = req.body;
  const startTime = String(req.body.startTime || '');
  const endTime = String(req.body.endTime || '');
  const note = String(req.body.note || '').trim().slice(0, 100);
  if (!mongoose.isValidObjectId(userId)) return { error: 'Choose who works this shift' };
  const user = await User.findById(userId).select('firstName lastName role isActive');
  if (!user || !CONSOLE_ROLES.includes(user.role)) return { error: 'Shifts are for staff and admin accounts' };
  if (user.isActive === false) return { error: `${nameOf(user)}'s account is deactivated` };
  if (!U.isDateStr(date)) return { error: 'Choose the day' };
  if (!START_RE.test(startTime) || !END_RE.test(endTime)) return { error: 'Use times like 08:00 and 16:00' };
  if (endTime <= startTime) return { error: 'The shift must end after it starts (on the same day)' };
  const day = U.manilaMidnight(date);
  const clash = await Shift.findOne({ user: user._id, date: day, _id: { $ne: exceptId }, startTime: { $lt: endTime }, endTime: { $gt: startTime } });
  if (clash) return { error: `${nameOf(user)} already has a shift then: ${clash.startTime}–${clash.endTime}` };
  return { user, date: day, startTime, endTime, note };
}

router.get('/shifts', authorize('shifts'), async (req, res) => {
  try {
    let { from, to } = weekOf(U.todayStr());
    if (U.isDateStr(req.query.from)) ({ from, to } = { from: req.query.from, to: U.isDateStr(req.query.to) ? req.query.to : addDays(req.query.from, 6) });
    if (to < from) return bad(res, 'The end date must be after the start date');
    if ((U.manilaMidnight(to) - U.manilaMidnight(from)) / 864e5 > 62) return bad(res, 'Show up to two months at a time');
    const [shifts, team] = await Promise.all([
      Shift.find({ date: { $gte: U.manilaMidnight(from), $lte: U.manilaMidnight(to) } }).sort({ date: 1, startTime: 1 }).lean(),
      User.find({ role: { $in: CONSOLE_ROLES }, isActive: { $ne: false } }).select('firstName lastName role').sort({ role: -1, firstName: 1 }).lean(),
    ]);
    res.json({ success: true, from, to, today: U.todayStr(),
      shifts: shifts.map((s) => ({ ...s, date: U.toDateStr(s.date) })),
      team: team.map((u) => ({ id: u._id, name: nameOf(u), role: u.role })) });
  } catch (err) { handleError(res, err); }
});

router.post('/shifts', authorize('shifts'), async (req, res) => {
  try {
    const v = await readShift(req);
    if (v.error) return bad(res, v.error);
    const shift = await Shift.create({ user: v.user._id, userName: nameOf(v.user), date: v.date, startTime: v.startTime, endTime: v.endTime, note: v.note, createdBy: req.user._id });
    if (String(v.user._id) !== String(req.user._id)) await U.notify(v.user._id, `New shift: ${shiftLabel(shift)}. See My shifts.`, undefined, LINK);
    res.locals.auditDetail = `${shift.userName}: ${shiftLabel(shift)}`;
    res.status(201).json({ success: true, shift: { ...shift.toObject(), date: U.toDateStr(shift.date) } });
  } catch (err) { handleError(res, err); }
});

router.put('/shifts/:id', authorize('shifts'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Shift not found', 404);
    const shift = await Shift.findById(req.params.id);
    if (!shift) return bad(res, 'Shift not found', 404);
    C.assertFresh(req, shift, 'shift');
    const v = await readShift(req, shift._id);
    if (v.error) return bad(res, v.error);
    const before = shiftLabel(shift);
    const oldUser = shift.user;
    Object.assign(shift, { user: v.user._id, userName: nameOf(v.user), date: v.date, startTime: v.startTime, endTime: v.endTime, note: v.note });
    await shift.save();
    const now = shiftLabel(shift);
    if (String(oldUser) !== String(v.user._id)) {
      if (String(oldUser) !== String(req.user._id)) await U.notify(oldUser, `Shift removed: ${before}.`, undefined, LINK);
      if (String(v.user._id) !== String(req.user._id)) await U.notify(v.user._id, `New shift: ${now}. See My shifts.`, undefined, LINK);
    } else if (String(oldUser) !== String(req.user._id) && before !== now) {
      await U.notify(oldUser, `Shift changed: ${before} is now ${now}.`, undefined, LINK);
    }
    res.locals.auditDetail = `${shift.userName}: ${now}${before !== now ? ` (was ${before})` : ''}`;
    res.json({ success: true, shift: { ...shift.toObject(), date: U.toDateStr(shift.date) } });
  } catch (err) { handleError(res, err); }
});

router.delete('/shifts/:id', authorize('shifts'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Shift not found', 404);
    const shift = await Shift.findOneAndDelete({ _id: req.params.id, ...C.versionFilter(req) });
    if (!shift && !(await C.explainMiss(req, Shift, req.params.id, 'shift'))) return bad(res, 'Shift not found', 404);
    if (String(shift.user) !== String(req.user._id)) await U.notify(shift.user, `Shift removed: ${shiftLabel(shift)}.`, undefined, LINK);
    res.locals.auditDetail = `${shift.userName}: ${shiftLabel(shift)}`;
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

/** Today's shift being worked now, else the last one that started today, else the first one still to come today. */
function pickShift(todays, nowMin) {
  const m = (t) => U.toMinutes(t);
  return todays.find((s) => m(s.startTime) <= nowMin && nowMin < m(s.endTime))
    || [...todays].reverse().find((s) => m(s.startTime) <= nowMin)
    || todays[0] || null;
}

router.get('/shifts/mine', authorize('shifts.view', 'shifts'), async (req, res) => {
  try {
    const today = U.todayStr();
    const list = await Shift.find({ user: req.user._id, date: { $gte: U.manilaMidnight(addDays(today, -7)), $lte: U.manilaMidnight(addDays(today, 27)) } })
      .sort({ date: 1, startTime: 1 }).lean();
    const out = list.map((s) => ({ id: s._id, date: U.toDateStr(s.date), startTime: s.startTime, endTime: s.endTime, note: s.note }));
    const nowMin = nowMinutes();
    const todays = out.filter((s) => s.date === today);
    const current = todays.find((s) => U.toMinutes(s.startTime) <= nowMin && nowMin < U.toMinutes(s.endTime)) || null;
    const next = out.find((s) => s.date > today || (s.date === today && U.toMinutes(s.startTime) > nowMin)) || null;
    res.json({ success: true, today, now: U.toHHMM(nowMin), current, next, todays,
      upcoming: out.filter((s) => s.date >= today), recent: out.filter((s) => s.date < today).reverse() });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
module.exports.pickShift = pickShift;
