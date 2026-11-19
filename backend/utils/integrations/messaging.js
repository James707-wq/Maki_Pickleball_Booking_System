/**
 * Customer messages outside the website: email (Resend, or SMTP as a fallback).
 * It runs only when it is set up in backend/.env AND switched on under admin -> Integrations,
 * and only for customers who have not turned it off on their Profile page.
 * Nothing here ever throws into a request: failures are logged and skipped.
 */
const { env, isActive } = require('./index');

/* ---------------- Email ---------------- */

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emailHtml(firstName, text, booking) {
  const link = booking && env('CLIENT_URL') ? `${env('CLIENT_URL').replace(/\/+$/, '')}/booking-confirmation.html?id=${booking._id}` : '';
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#10243e;">
    <div style="background:#0a325e;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:700;">MAKI'S PICKLEBALL COURT</div>
    <div style="border:1px solid #d9e3f0;border-top:0;padding:20px;border-radius:0 0 12px 12px;">
      <p>Hi ${escapeHtml(firstName || 'there')},</p>
      <p>${escapeHtml(text)}</p>
      ${booking ? `<p style="background:#eef5fd;padding:10px 12px;border-radius:8px;">
        <b>${escapeHtml(booking.courtName)}</b><br>${escapeHtml(require('../bookingUtils').toDateStr(booking.date))}, ${escapeHtml(booking.startTime)}–${escapeHtml(booking.endTime)}<br>
        Reference: <b>${escapeHtml(booking.referenceNumber)}</b></p>` : ''}
      ${link ? `<p><a href="${link}" style="color:#0b4fa8;font-weight:600;">Open your booking</a></p>` : ''}
      <p style="color:#5b6b82;font-size:12px;">You can turn these emails off on your Profile page.</p>
    </div></div>`;
}

/** .ics calendar file for a confirmed booking (attached to the confirmation email). */
function icsFor(booking) {
  const U = require('../bookingUtils');
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = U.startInstant(booking);
  const end = U.endInstant(booking);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MAKI PickleBall Court//Bookings//EN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${booking.referenceNumber}@makis-pickleball`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:Pickleball · ${booking.courtName}`,
    `DESCRIPTION:Booking ${booking.referenceNumber}. Show your QR code or reference at check-in.`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Pickleball in 2 hours', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

/* ---------------- one place to message a customer ---------------- */

/**
 * Sends `text` to the customer by email (in-app notifications are handled by U.notify).
 * opts: { subject, booking, attachIcs }
 */
async function deliver(userId, text, { subject = "Update from MAKI's PickleBall Court", booking = null, attachIcs = false } = {}) {
  try {
    if (!(await isActive('email'))) return;
    const User = require('../../models/User');
    const user = await User.findById(userId).select('firstName email notifyEmail isActive');
    if (!user || user.isActive === false || user.notifyEmail === false || !user.email) return;
    const sendEmail = require('../sendEmail');
    await sendEmail({
      to: user.email, subject, html: emailHtml(user.firstName, text, booking),
      attachments: attachIcs && booking ? [{ filename: `pickleball-${booking.referenceNumber}.ics`, content: icsFor(booking), contentType: 'text/calendar' }] : undefined,
    });
  } catch (err) {
    console.error('Customer email failed:', err.message);
  }
}

module.exports = { deliver, icsFor };
