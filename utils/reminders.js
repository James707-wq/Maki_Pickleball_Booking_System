/**
 * Sends an in-app reminder about 2 hours before a confirmed booking starts.
 * Runs once a minute from server.js. Each booking is reminded only once
 * (Booking.reminderSentAt); rescheduling a booking clears it so the new time is reminded too.
 */
const Booking = require('../models/Booking');
const U = require('./bookingUtils');

const REMIND_BEFORE_MIN = 120;

async function sendDueReminders() {
  const now = new Date();
  const dayStart = U.manilaMidnight(U.todayStr());
  const candidates = await Booking.find({
    status: 'confirmed',
    reminderSentAt: { $exists: false },
    date: { $gte: dayStart, $lt: new Date(dayStart.getTime() + 2 * 24 * 60 * 60 * 1000) },
  }).select('date startTime courtName referenceNumber user');

  for (const b of candidates) {
    const startsAt = b.date.getTime() + U.toMinutes(b.startTime) * 60000;
    const minutesLeft = Math.round((startsAt - now.getTime()) / 60000);
    if (minutesLeft <= 0 || minutesLeft > REMIND_BEFORE_MIN) continue;

    // claim it first so two server loops can never send the same reminder twice
    const claimed = await Booking.findOneAndUpdate(
      { _id: b._id, status: 'confirmed', reminderSentAt: { $exists: false } },
      { $set: { reminderSentAt: now } }
    );
    if (!claimed) continue;

    const when = minutesLeft >= 105 ? 'in about 2 hours' : `in ${minutesLeft} minutes`;
    await U.notify(b.user, `Reminder: your booking ${b.referenceNumber} at ${b.courtName} starts at ${b.startTime} (${when}).`);
  }
}

function startReminders() {
  const run = () => sendDueReminders().catch((err) => console.error('Reminder job failed:', err.message));
  setTimeout(run, 5000);          // shortly after start-up
  setInterval(run, 60 * 1000);    // then every minute
}

module.exports = { sendDueReminders, startReminders };