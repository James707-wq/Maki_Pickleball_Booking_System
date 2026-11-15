const Booking = require('../models/Booking');
const Court = require('../models/Court');
const BlockedSlot = require('../models/BlockedSlot');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { PERMISSIONS } = require('../config/permissions');
const { nextTimestamp, WriteConflictError } = require('./concurrency');

const ACTIVE_STATUSES = ['pending', 'confirmed', 'completed'];
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // Philippines is UTC+8, no DST

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// "2026-10-12" -> Date at 00:00 Manila time, whatever timezone the server runs in
const manilaMidnight = (dateStr) => new Date(`${dateStr}T00:00:00+08:00`);
const isDateStr = (s) => typeof s === 'string' && DATE_RE.test(s) && !isNaN(manilaMidnight(s).getTime());
// Date -> "YYYY-MM-DD" as seen in Manila
const toDateStr = (d) => new Date(new Date(d).getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
const todayStr = () => toDateStr(new Date());

const startInstant = (b) => new Date(new Date(b.date).getTime() + toMinutes(b.startTime) * 60000);
const endInstant = (b) => new Date(new Date(b.date).getTime() + toMinutes(b.endTime) * 60000);

/** Every slot start (minutes) a court offers, based on its hours and slot length. */
const slotStarts = (open, close, step) => {
  const out = [];
  for (let s = toMinutes(open); s + step <= toMinutes(close); s += step) out.push(s);
  return out;
};

const EXPIRED_REASON = 'Expired: it was not approved before the booking time';

/**
 * Tidies bookings whose time has passed:
 *  - confirmed -> completed
 *  - still pending (never approved) once the start time passes -> cancelled as expired, so it leaves the
 *    approval queue and shows in the customer's history instead of hanging around forever.
 */
async function autoCompleteBookings(extra = {}) {
  const now = new Date();
  const candidates = await Booking.find({ status: 'confirmed', date: { $lte: now }, ...extra }).select('date endTime');
  const ids = candidates.filter((b) => endInstant(b) <= now).map((b) => b._id);
  // status is re-checked inside the update: a booking cancelled after we read it must not become "completed"
  if (ids.length) await Booking.updateMany({ _id: { $in: ids }, status: 'confirmed' }, { status: 'completed' });

  const pending = await Booking.find({ status: 'pending', date: { $lte: now }, ...extra })
    .select('date startTime user referenceNumber courtName paymentStatus');
  for (const b of pending.filter((x) => startInstant(x) <= now)) {
    // only one caller may expire it (several pages can trigger this at once)
    const done = await Booking.updateOne(
      { _id: b._id, status: 'pending' },
      { $set: { status: 'cancelled', slotActive: false, statusReason: EXPIRED_REASON, statusChangedAt: now } }
    );
    if (!done.modifiedCount) continue;
    await notify(b.user, `Booking ${b.referenceNumber} (${b.courtName}, ${toDateStr(b.date)} ${b.startTime}) expired because it was not approved in time. Please book another slot.`,
      { subject: `Booking ${b.referenceNumber} expired` });
    if (b.paymentStatus === 'paid') {
      await notifyStaff(`Booking ${b.referenceNumber} expired without approval but was already paid. Please refund the customer.`);
    }
  }
}

/**
 * Validation + write phase for a court's schedule (timestamp ordering across collections).
 *
 * Anything that adds to what occupies a court's slots (a booking placed or moved onto it, a block, a
 * booking brought back from cancelled) follows: read court (remember scheduleTS) -> read and check the
 * slots -> write -> commitSchedule. The commit only succeeds if nobody changed the schedule since we read
 * it; if it fails the caller undoes its write and the request restarts with a new timestamp.
 * Returns true on success.
 */
async function commitSchedule(court) {
  const seen = court.scheduleTS || null;
  const next = nextTimestamp();
  const r = await Court.updateOne(
    { _id: court._id, scheduleTS: seen },
    { $set: { scheduleTS: next } },
    { timestamps: false }
  );
  if (r.matchedCount === 1) { court.scheduleTS = next; return true; }
  return false;
}

/** Same as commitSchedule but throws a retryable conflict when the schedule moved under us. */
async function commitScheduleOrUndo(court, undo) {
  if (await commitSchedule(court)) return;
  try { await undo(); } catch (e) { console.error('Rollback failed:', e.message); }
  throw new WriteConflictError('The court schedule changed while this was being saved. Please try again.');
}

const fail = (code, message) => ({ ok: false, code, message });

/**
 * Single source of truth for "can this court be booked at this date/time?"
 * Used by customer booking, admin reschedule, and admin re-activation of bookings.
 */
async function validateSlot(court, date, startTime, { excludeBookingId = null, allowPast = false } = {}) {
  if (!isDateStr(date) || typeof startTime !== 'string' || !TIME_RE.test(startTime)) {
    return fail(400, 'Invalid date or start time');
  }
  if (court.status !== 'available') return fail(400, `This court is currently ${court.status}`);

  const openMin = toMinutes(court.openTime);
  const closeMin = toMinutes(court.closeTime);
  const step = court.slotDurationMinutes;
  const startMin = toMinutes(startTime);

  if (startMin < openMin || startMin + step > closeMin || (startMin - openMin) % step !== 0) {
    return fail(400, 'Selected time is not a valid slot for this court');
  }

  const bookingDate = manilaMidnight(date);
  if (!allowPast && new Date(bookingDate.getTime() + startMin * 60000) <= new Date()) {
    return fail(400, "Can't book a time that has already passed");
  }

  if (await BlockedSlot.findOne({ court: court._id, date: bookingDate, startTime })) {
    return fail(409, 'That time slot is not open for booking');
  }

  const clashFilter = { court: court._id, date: bookingDate, startTime, status: { $in: ACTIVE_STATUSES } };
  if (excludeBookingId) clashFilter._id = { $ne: excludeBookingId };
  if (await Booking.findOne(clashFilter)) {
           return fail(409, 'That date and time is already booked. Please choose another time or court.');
  }

  return {
    ok: true,
    bookingDate,
    startMin,
    endTime: toHHMM(startMin + step),
    totalFee: Math.round((court.pricePerHour * step) / 60),
  };
}

/**
 * Creates an in-app notification; never lets a notification failure break the main action.
 * With `outside` ({ subject, booking, attachIcs }) the customer also gets it by SMS / email when those
 * are switched on - sent in the background so the request never waits on them.
 */
async function notify(userId, message, outside) {
  try {
    await Notification.create({ user: userId, message });
  } catch (err) {
    console.error('Notification failed:', err.message);
  }
  if (outside) {
    const { deliver } = require('./integrations/messaging');
    setImmediate(() => deliver(userId, message, outside));
  }
}

/** Notifies every active staff/admin account that manages bookings. Never throws. */
async function notifyStaff(message) {
  try {
    const roles = Object.keys(PERMISSIONS).filter((r) => PERMISSIONS[r].includes('bookings'));
    const staff = await User.find({ role: { $in: roles }, isActive: { $ne: false } }).select('_id');
    if (staff.length) await Notification.insertMany(staff.map((u) => ({ user: u._id, message })));
  } catch (err) {
    console.error('Staff notification failed:', err.message);
  }
}

module.exports = {
  ACTIVE_STATUSES, toMinutes, toHHMM, manilaMidnight, isDateStr, toDateStr, todayStr,
  startInstant, endInstant, slotStarts, autoCompleteBookings, validateSlot, notify, notifyStaff,
  commitSchedule, commitScheduleOrUndo,
};
