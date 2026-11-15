/**
 * Customer messages outside the website: SMS (Semaphore) and email (Resend, or SMTP as a fallback).
 * Each channel runs only when it is set up in backend/.env AND switched on under admin -> Integrations,
 * and only for customers who have not turned it off on their Profile page.
 * Nothing here ever throws into a request: failures are logged and skipped.
 */
const { env, isActive } = require('./index');

/* ---------------- SMS (Semaphore, Philippines) ---------------- */

/** "0917 123 4567", "+63 917-123-4567", "9171234567" -> "09171234567"; anything else -> null. */
function normalizePhMobile(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('63') && d.length === 12) d = '0' + d.slice(2);
  if (d.startsWith('9') && d.length === 10) d = '0' + d;
  return /^09\d{9}$/.test(d) ? d : null;
}

async function sendSms(phone, text) {
  const number = normalizePhMobile(phone);
  if (!number) return { ok: false, reason: 'no valid PH mobile number' };
  const body = new URLSearchParams({ apikey: env('SEMAPHORE_API_KEY'), number, message: String(text).slice(0, 450) });
  if (env('SEMAPHORE_SENDER_NAME')) body.set('sendername', env('SEMAPHORE_SENDER_NAME'));
  const r = await fetch(env('SEMAPHORE_API_URL') || 'https://api.semaphore.co/api/v4/messages', { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Semaphore ${r.status}: ${detail.slice(0, 200)}`);
  }
  return { ok: true };
}

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
 * Sends `text` to the customer by SMS and/or email (in-app notifications are handled by U.notify).
 * opts: { subject, booking, attachIcs }
 */
async function deliver(userId, text, { subject = "Update from MAKI's PickleBall Court", booking = null, attachIcs = false } = {}) {
  try {
    const [smsOn, emailOn] = await Promise.all([isActive('sms'), isActive('email')]);
    if (!smsOn && !emailOn) return;
    const User = require('../../models/User');
    const user = await User.findById(userId).select('firstName email phone notifySms notifyEmail isActive');
    if (!user || user.isActive === false) return;

    if (smsOn && user.notifySms !== false && user.phone) {
      try { await sendSms(user.phone, `MAKI's Pickleball: ${text}`); } catch (err) { console.error('SMS failed:', err.message); }
    }
    if (emailOn && user.notifyEmail !== false && user.email) {
      try {
        const sendEmail = require('../sendEmail');
        await sendEmail({
          to: user.email, subject, html: emailHtml(user.firstName, text, booking),
          attachments: attachIcs && booking ? [{ filename: `pickleball-${booking.referenceNumber}.ics`, content: icsFor(booking), contentType: 'text/calendar' }] : undefined,
        });
      } catch (err) { console.error('Email failed:', err.message); }
    }
  } catch (err) {
    console.error('Customer message failed:', err.message);
  }
}

module.exports = { deliver, sendSms, normalizePhMobile, icsFor };
