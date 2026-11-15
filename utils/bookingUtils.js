const Booking = require('../models/Booking');
const Court = require('../models/Court');
const BlockedSlot = require('../models/BlockedSlot');
const Notification = require('../models/Notification');
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

const endInstant = (b) => new Date(new Date(b.date).getTime() + toMinutes(b.endTime) * 60000);

/** Every slot start (minutes) a court offers, based on its hours and slot length. */
const slotStarts = (open, close, step) => {
  const out = [];
  for (let s = toMinutes(open); s + step <= toMinutes(close); s += step) out.push(s);
  return out;
};

/**
 * Housekeeping, run whenever bookings are listed:
 *  - confirmed bookings whose time has passed become "completed"
 *  - pending bookings nobody approved before their time become "cancelled"
 */
async function autoCompleteBookings(extra = {}) {
  const now = new Date();
  const candidates = await Booking.find({ status: 'confirmed', date: { $lte: now }, ...extra }).select('date endTime');
  const ids = candidates.filter((b) => endInstant(b) <= now).map((b) => b._id);
  // status is re-checked inside the update: a booking cancelled after we read it must not become "completed"
  if (ids.length) await Booking.updateMany({ _id: { $in: ids }, status: 'confirmed' }, { status: 'completed' });

  const stale = await Booking.find({ status: 'pending', date: { $lte: now }, ...extra }).select('date endTime user referenceNumber');
  const reason = 'Not approved before the booking time';
  for (const b of stale.filter((x) => endInstant(x) <= now)) {
    // claim each booking atomically so two requests running this job never notify twice,
    // and a booking approved in the meantime is left alone
    const expired = await Booking.findOneAndUpdate(
      { _id: b._id, status: 'pending' },
      { status: 'cancelled', statusReason: reason, statusChangedAt: now, slotActive: false }
    );
    if (expired) await notify(b.user, `Your booking ${b.referenceNumber} expired because it was not approved before the booking time.`);
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

/** Notifies every active staff/admin account that can manage bookings. Never breaks the main action. */
async function notifyStaff(message, feature = 'bookings') {
  try {
    const User = require('../models/User');
    const { PERMISSIONS } = require('../config/permissions');
    const roles = Object.keys(PERMISSIONS).filter((r) => r !== 'user' && PERMISSIONS[r].includes(feature));
    const ids = await User.find({ role: { $in: roles }, isActive: true }).distinct('_id');
    if (ids.length) await Notification.insertMany(ids.map((user) => ({ user, message })));
  } catch (err) {
    console.error('Staff notification failed:', err.message);
  }
}
/** Creates an in-app notification; never lets a notification failure break the main action. */
async function notify(userId, message) {
  try {
    await Notification.create({ user: userId, message });
  } catch (err) {
    console.error('Notification failed:', err.message);
  }
}

module.exports = {
  ACTIVE_STATUSES, toMinutes, toHHMM, manilaMidnight, isDateStr, toDateStr, todayStr,
  endInstant, slotStarts, autoCompleteBookings, validateSlot, notify, notifyStaff, commitSchedule, commitScheduleOrUndo,
};