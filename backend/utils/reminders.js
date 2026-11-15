/**
<<<<<<< HEAD:backend/utils/reminders.js
 * UF-129 Booking Reminders: every few minutes, remind customers about confirmed
 * bookings that start within the next 2 hours. Each booking is reminded once
 * (reminderSentAt); moving a booking clears it so the new time gets a reminder.
=======
 * Sends an in-app reminder about 2 hours before a confirmed booking starts.
 * Runs once a minute from server.js. Each booking is reminded only once
 * (Booking.reminderSentAt); rescheduling a booking clears it so the new time is reminded too.
>>>>>>> a7268bdf5982b171a935f488c3beb16a426aba2c:utils/reminders.js
 */
const Booking = require('../models/Booking');
const U = require('./bookingUtils');

<<<<<<< HEAD:backend/utils/reminders.js
const REMIND_BEFORE_MS = 2 * 60 * 60 * 1000; // 2 hours
const CHECK_EVERY_MS = 5 * 60 * 1000;        // 5 minutes


async function sendDueReminders(now = new Date()) {
  const until = new Date(now.getTime() + REMIND_BEFORE_MS);
  // dates are stored as Manila midnight, so look one day back to catch today's bookings
  const candidates = await Booking.find({
    status: 'confirmed',
    reminderSentAt: { $exists: false },
    date: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), $lte: until },
  }).select('date startTime');

  let sent = 0;
  for (const c of candidates) {
    const start = U.startInstant(c);
    if (start <= now || start > until) continue;

    // claim it atomically so two server instances never send the same reminder twice
    const booking = await Booking.findOneAndUpdate(
      { _id: c._id, status: 'confirmed', reminderSentAt: { $exists: false } },
      { $set: { reminderSentAt: now } },
      { new: true }
    );
    if (!booking || !booking.user) continue;

    const when = `${U.toDateStr(booking.date)} at ${booking.startTime}`;
    const message = `Reminder: your booking ${booking.referenceNumber} at ${booking.courtName} starts ${when} (in about 2 hours).`;
    // in-app, plus SMS / email when switched on (see utils/integrations/messaging.js)
    await U.notify(booking.user, message, { subject: `Reminder: ${booking.courtName} today at ${booking.startTime}`, booking });
    sent += 1;
  }
  return sent;
}

function startReminderJob() {
  const run = () => sendDueReminders().catch((err) => console.error('Reminder job failed:', err.message));
  setTimeout(run, 10 * 1000); // first run shortly after start-up, once the database is connected
  setInterval(run, CHECK_EVERY_MS);
}

module.exports = { startReminderJob, sendDueReminders, REMIND_BEFORE_MS };
=======
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
>>>>>>> a7268bdf5982b171a935f488c3beb16a426aba2c:utils/reminders.js
