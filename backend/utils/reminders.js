/**
 * UF-129 Booking Reminders: every few minutes, remind customers about confirmed
 * bookings that start within the next 2 hours. Each booking is reminded once
 * (reminderSentAt); moving a booking clears it so the new time gets a reminder.
 */
const Booking = require('../models/Booking');
const U = require('./bookingUtils');

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

    // approved less than 2 hours before the start? say how soon it really is
    const minutesLeft = Math.ceil((start - now) / 60000);
    const soon = minutesLeft >= 105 ? 'in about 2 hours' : `in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}`;
    const when = `${U.toDateStr(booking.date)} at ${booking.startTime}`;
    const message = `Reminder: your booking ${booking.referenceNumber} at ${booking.courtName} starts ${when} (${soon}).`;
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
