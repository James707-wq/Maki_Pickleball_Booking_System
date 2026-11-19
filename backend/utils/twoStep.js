/**
 * Two-step check for sensitive admin changes (turning integrations on or off):
 *   1. the admin's security PIN (created under My account, or the first time it is needed), then
 *   2. a 6-digit one-time code sent to the admin's email.
 * After the change every admin gets a security alert (dashboard, plus email when it is set up).
 *
 * Codes and alerts go out whenever email is set up in backend/.env, even if the Email integration is
 * switched off, so turning "Email" off can never lock the admins out.
 * With no email set up, the code is printed in the server console instead, except with
 * NODE_ENV=production, where changes are refused until email is set up.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Notification = require('../models/Notification');
const SecurityCode = require('../models/SecurityCode');
const sendEmail = require('./sendEmail');
const auditSecurityEvent = require('./securityAudit');
const { configured } = require('./integrations');
const { PERMISSIONS } = require('../config/permissions');

const MAX_TRIES = 5;       // wrong PINs/passwords in a row before a lock; wrong tries per code
const LOCK_MINUTES = 15;
const CODE_MINUTES = 10;   // how long a code works
const RESEND_SECONDS = 30; // wait before another code can be sent
const MAX_SENDS = 3;       // codes per change: the first one + 2 resends
const MAX_STARTS = 5;      // changes started per admin per 15 minutes

const EXPIRED = 'This code has expired or was already used. Close this window and start again.';
const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const tries = (n) => `${n} ${n === 1 ? 'try' : 'tries'}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const consoleFallback = () => process.env.NODE_ENV !== 'production';
const manilaTime = (d) => d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
const ipOf = (req) => String(req.ip || 'unknown').replace(/^::ffff:/, ''); // "::ffff:1.2.3.4" -> "1.2.3.4"
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sends one email, and once more after a short pause if it fails (mail servers often refuse for a moment). Never throws. */
async function sendTwice(mail, label) {
  try { await sendEmail(mail); return true; } catch (err) { console.error(`${label} failed, trying again:`, err.message); }
  await pause(2000);
  try { await sendEmail(mail); return true; } catch (err) { console.error(`${label} failed:`, err.message); return false; }
}

/** Branded email. `parts` are HTML paragraphs (escape anything people typed); { code } draws the code box. */
function emailHtml(firstName, parts) {
  const body = parts.map((p) => (p && p.code
    ? `<p style="font-size:30px;font-weight:700;letter-spacing:8px;text-align:center;background:#eef5fd;padding:14px;border-radius:8px;margin:16px 0;">${esc(p.code)}</p>`
    : `<p>${p}</p>`)).join('');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#10243e;">
    <div style="background:#0a325e;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:700;">MAKI'S PICKLEBALL COURT · Admin security</div>
    <div style="border:1px solid #d9e3f0;border-top:0;padding:20px;border-radius:0 0 12px 12px;">
      <p>Hi ${esc(firstName || 'there')},</p>${body}
    </div></div>`;
}

/* ---------------- the security PIN ---------------- */

/** Why a new PIN can't be used, or null when it is fine. */
function pinProblem(pin) {
  const p = typeof pin === 'string' ? pin : '';
  if (!/^\d{4,6}$/.test(p)) return 'Your PIN must be 4 to 6 digits';
  if (/^(\d)\1+$/.test(p)) return 'Pick a PIN that is not one digit repeated';
  if ('01234567890'.includes(p) || '09876543210'.includes(p)) return 'Pick a PIN that is not a simple run like 1234';
  return null;
}

/**
 * Runs check(user) as one counted security try (PIN or account password). MAX_TRIES wrong tries in a
 * row lock the PIN for LOCK_MINUTES. The try is counted before it is checked, so guesses sent all at
 * once can't get past the limit. Returns { ok: true } or a fail() (with `left` when tries remain).
 */
async function countedTry(userId, check) {
  const now = new Date();
  // a lock that has run out starts a fresh count
  await User.updateOne({ _id: userId, pinLockedUntil: { $lte: now } }, { $set: { pinFailedAttempts: 0 }, $unset: { pinLockedUntil: 1 } });
  const user = await User.findOneAndUpdate(
    { _id: userId, pinFailedAttempts: { $not: { $gte: MAX_TRIES } } }, // $not also matches accounts that never had a wrong try
    { $inc: { pinFailedAttempts: 1 } },
    { new: true }
  ).select('+password +securityPin +pinFailedAttempts +pinLockedUntil');
  if (!user) return lockedFail(userId);

  if (await check(user)) {
    await User.updateOne({ _id: userId }, { $set: { pinFailedAttempts: 0 }, $unset: { pinLockedUntil: 1 } });
    return { ok: true };
  }
  const left = MAX_TRIES - user.pinFailedAttempts;
  if (left > 0) return fail(400, '', { left });
  await User.updateOne({ _id: userId }, { $set: { pinLockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60000) } });
  return fail(429, `Too many wrong tries. Your PIN is locked for ${LOCK_MINUTES} minutes.`, { lockedNow: true });
}

async function lockedFail(userId) {
  const u = await User.findById(userId).select('+pinLockedUntil');
  let until = u && u.pinLockedUntil;
  if (!until) { // the count is full but no lock time was saved (a request stopped half-way): lock from now
    until = new Date(Date.now() + LOCK_MINUTES * 60000);
    await User.updateOne({ _id: userId }, { $set: { pinLockedUntil: until } });
  }
  const mins = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return fail(429, `Too many wrong tries. Try again in ${plural(mins, 'minute')}.`);
}

const lockAction = (r, wrong) => (r.lockedNow ? 'Security PIN locked after wrong tries' : r.status === 429 ? 'Tried a locked security PIN' : wrong);

/** Checks the signed-in admin's PIN. Wrong tries are counted, audit-logged and lock the PIN. */
async function checkPin(req, pin) {
  if (!req.user.securityPinSetAt) {
    return fail(428, "You haven't created a security PIN yet. Create one under My account.", { needsPin: true });
  }
  const p = typeof pin === 'string' ? pin : '';
  if (!/^\d{4,6}$/.test(p)) return fail(400, 'Enter your 4 to 6 digit PIN'); // a typo in the format doesn't use up a try
  const r = await countedTry(req.user._id, (u) => Boolean(u.securityPin) && bcrypt.compare(p, u.securityPin));
  if (r.ok) return r;
  auditSecurityEvent(req, { action: lockAction(r, 'Wrong security PIN'), user: req.user, statusCode: r.status, detail: r.left ? `${tries(r.left)} left` : '' });
  return r.left ? fail(400, `That PIN is not right. ${tries(r.left)} left.`) : r;
}

/** Creates or changes the signed-in admin's PIN. Needs their account password (also a counted try). */
async function setPin(req, password, pin) {
  const problem = pinProblem(pin);
  if (problem) return fail(400, problem);
  if (typeof password !== 'string' || !password) return fail(400, 'Enter your account password');
  const r = await countedTry(req.user._id, (u) => u.matchPassword(password));
  if (!r.ok) {
    auditSecurityEvent(req, { action: lockAction(r, 'Wrong password while setting the security PIN'), user: req.user, statusCode: r.status });
    return r.left ? fail(400, `Your account password is not right. ${tries(r.left)} left.`) : r;
  }

  const first = !req.user.securityPinSetAt;
  const now = new Date();
  await User.updateOne({ _id: req.user._id }, { $set: { securityPin: await bcrypt.hash(pin, 10), securityPinSetAt: now } });
  // codes asked for with the old PIN stop working
  await SecurityCode.updateMany({ user: req.user._id, usedAt: null, expiresAt: { $gt: now } }, { $set: { expiresAt: now } });

  if (configured.email()) {
    const { email, firstName } = req.user;
    const ip = ipOf(req);
    setImmediate(() => sendTwice({
      to: email,
      subject: `Your admin security PIN was ${first ? 'created' : 'changed'}`,
      html: emailHtml(firstName, [
        `Your security PIN for MAKI's PickleBall Court admin was ${first ? 'created' : 'changed'} on ${esc(manilaTime(now))} (Philippine time) from IP address ${esc(ip)}.`,
        'If this was not you, change your account password right away and tell the other admins.',
      ]),
    }, 'PIN change email'));
  }
  return { ok: true, first, setAt: now };
}

/* ---------------- one-time codes ---------------- */

const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const hashCode = (id, code) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${id}:${code}`).digest('hex');
const sameHash = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const maskEmail = (email) => {
  const [name, domain] = String(email || '').split('@');
  return name && domain ? `${name[0]}${'*'.repeat(Math.min(Math.max(name.length - 1, 1), 6))}@${domain}` : '';
};
/** Where a code for this user goes: [{ channel: 'email' | 'console', label }]. */
function destinations(user) {
  const out = [];
  if (configured.email() && user.email) out.push({ channel: 'email', label: maskEmail(user.email) });
  if (!out.length && consoleFallback()) out.push({ channel: 'console', label: 'the server console' });
  return out;
}

/** What the admin console needs before it asks for the PIN. Never includes secrets. */
function summary(user) {
  const to = destinations(user);
  return {
    pinSet: Boolean(user.securityPinSetAt),
    pinSetAt: user.securityPinSetAt || null,
    codeTo: to.map((d) => d.label),
    canSendCodes: to.length > 0,
    viaConsole: to.some((d) => d.channel === 'console'),
  };
}

/**
 * Sends the code by email. Returns where it went (empty when nothing worked).
 * A console entry has failed: true when email is set up but could not send just now.
 */
async function deliverCode(user, code, what) {
  const sent = [];
  let failed = false;
  if (configured.email() && user.email) {
    const ok = await sendTwice({
      to: user.email,
      subject: "Your MAKI's PickleBall security code",
      html: emailHtml(user.firstName, [
        `Use this code to confirm: <b>${esc(what)}</b>.`,
        { code },
        `It works once and expires in ${CODE_MINUTES} minutes. Never share it: nobody from the facility will ask you for it.`,
        'If you did not just ask for this code, someone may know your password and PIN. Change both right away.',
      ]),
    }, 'Security code email');
    if (ok) sent.push({ channel: 'email', label: maskEmail(user.email) }); else failed = true;
  }
  if (!sent.length && consoleFallback()) {
    console.log(`\n[security code] ${code}  for ${user.email}: ${what} (expires in ${CODE_MINUTES} minutes)\n`
      + (failed
        ? '  Shown here because the email could not be sent just now (see the error above).\n'
        : '  Shown here because email is not set up. Set up email in backend/.env; with NODE_ENV=production codes are never printed.\n'));
    sent.push({ channel: 'console', label: failed ? 'the server console (email failed)' : 'the server console', failed });
  }
  return sent;
}

const noChannelMessage = () => (configured.email()
  ? 'The code could not be sent. Try again in a minute.'
  : 'Codes are sent by email, but email is not set up. Add RESEND_API_KEY (or EMAIL_HOST, EMAIL_PORT, EMAIL_USER and EMAIL_PASS) to backend/.env and restart the server.');

/**
 * Saves a change that waits for a code and sends the code. Call only after the PIN was right.
 * `payload` is what the route applies once the code is right; `what` describes it to the admin.
 */
async function startChallenge(req, purpose, payload, what) {
  const userId = req.user._id;
  const now = new Date();
  const recent = await SecurityCode.countDocuments({ user: userId, createdAt: { $gt: new Date(now.getTime() - 15 * 60000) } });
  if (recent >= MAX_STARTS) return fail(429, 'Too many codes were asked for. Wait 15 minutes and try again.');

  await SecurityCode.updateMany({ user: userId, purpose, usedAt: null, expiresAt: { $gt: now } }, { $set: { expiresAt: now } }); // only the newest code works
  const code = newCode();
  const challenge = new SecurityCode({ user: userId, purpose, payload, what, lastSentAt: now, expiresAt: new Date(now.getTime() + CODE_MINUTES * 60000) });
  challenge.codeHash = hashCode(challenge._id, code);
  await challenge.save();

  const sentTo = await deliverCode(req.user, code, what);
  if (!sentTo.length) {
    await SecurityCode.updateOne({ _id: challenge._id }, { $set: { expiresAt: new Date() } });
    return fail(503, noChannelMessage());
  }
  await SecurityCode.updateOne({ _id: challenge._id }, { $set: { sentTo: sentTo.map((s) => s.label) } });
  return { ok: true, challenge, sentTo };
}

/** Sends a fresh code for a change that is still waiting. The old code stops working. */
async function resendChallenge(req, purpose, id) {
  if (!mongoose.isValidObjectId(id)) return fail(400, EXPIRED);
  const now = new Date();
  const ch = await SecurityCode.findOne({ _id: id, user: req.user._id, purpose, usedAt: null, expiresAt: { $gt: now } });
  if (!ch) return fail(400, EXPIRED);
  const wait = Math.ceil((ch.lastSentAt.getTime() + RESEND_SECONDS * 1000 - now.getTime()) / 1000);
  if (wait > 0) return fail(429, `Wait ${plural(wait, 'second')} before asking for a new code.`);
  if (ch.sends >= MAX_SENDS) return fail(429, 'No more codes can be sent for this change. Close this window and start again.');

  const code = newCode();
  const next = await SecurityCode.findOneAndUpdate(
    { _id: ch._id, usedAt: null, sends: ch.sends }, // nobody resent it in the meantime
    { $set: { codeHash: hashCode(ch._id, code), attempts: 0, lastSentAt: now, expiresAt: new Date(now.getTime() + CODE_MINUTES * 60000) }, $inc: { sends: 1 } },
    { new: true }
  );
  if (!next) return fail(409, 'A new code was just sent. Check your email.');
  const sentTo = await deliverCode(req.user, code, ch.what);
  if (!sentTo.length) return fail(503, noChannelMessage());
  return { ok: true, challenge: next, sentTo };
}

/** Checks a code. When it is right, marks it used and returns the change that was saved with it. */
async function useChallenge(req, purpose, id, otp) {
  const code = typeof otp === 'string' ? otp.replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(code)) return fail(400, 'Enter the 6-digit code');
  if (!mongoose.isValidObjectId(id)) return fail(400, EXPIRED);
  const now = new Date();
  // the try is counted before the code is checked, so guesses sent all at once can't get past the limit
  const ch = await SecurityCode.findOneAndUpdate(
    { _id: id, user: req.user._id, purpose, usedAt: null, expiresAt: { $gt: now }, attempts: { $lt: MAX_TRIES } },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (!ch) return fail(400, EXPIRED);
  if (!sameHash(ch.codeHash, hashCode(ch._id, code))) {
    const left = MAX_TRIES - ch.attempts;
    auditSecurityEvent(req, { action: 'Wrong one-time code', user: req.user, statusCode: left > 0 ? 400 : 429, detail: ch.what });
    if (left > 0) return fail(400, `That code is not right. ${tries(left)} left.`);
    await SecurityCode.updateOne({ _id: ch._id }, { $set: { expiresAt: now } });
    return fail(429, 'Too many wrong codes. Close this window and start again for a new code.');
  }
  const used = await SecurityCode.findOneAndUpdate({ _id: ch._id, usedAt: null }, { $set: { usedAt: now } }, { new: true });
  if (!used) return fail(400, EXPIRED);
  return { ok: true, challenge: used };
}

/** The part of a waiting change the admin console may see (never the code). */
const challengeView = (challenge, sentTo) => ({
  challengeId: challenge._id,
  sentTo: sentTo.map((s) => s.label),
  viaConsole: sentTo.some((s) => s.channel === 'console'),
  emailFailed: sentTo.some((s) => s.channel === 'console' && s.failed), // email is set up but could not send just now
  expiresAt: challenge.expiresAt,
  expiresInMinutes: CODE_MINUTES,
  resendIn: RESEND_SECONDS,
  resendsLeft: Math.max(0, MAX_SENDS - challenge.sends),
});

/* ---------------- alerts after a change ---------------- */

/**
 * Tells every active admin that integrations changed: a dashboard alert, plus an email when email is
 * set up. Runs in the background and never throws. Returns whether emails are being sent.
 * `title` / `did` describe other sensitive actions, e.g. { title: 'Backup & restore', did: 'used Backup & restore' }.
 */
function alertAdmins(req, changeSummary, { title = 'Integrations changed', did = 'changed the integrations' } = {}) {
  const actor = `${req.user.firstName} ${req.user.lastName}`.trim();
  const actorEmail = req.user.email;
  const ip = ipOf(req);
  const when = manilaTime(new Date());
  const emailOn = configured.email();
  setImmediate(async () => {
    try {
      const roles = Object.keys(PERMISSIONS).filter((r) => PERMISSIONS[r].includes('settings'));
      const admins = await User.find({ role: { $in: roles }, isActive: { $ne: false } }).select('firstName email');
      await Notification.insertMany(admins.map((a) => ({
        user: a._id, message: `${title} by ${actor}: ${changeSummary}. Confirmed with PIN and one-time code.`,
      })));
      if (!emailOn) return;
      let emailed = 0;
      for (const a of admins) {
        const ok = await sendTwice({
          to: a.email,
          subject: `${title}: ${changeSummary}`,
          html: emailHtml(a.firstName, [
            `<b>${esc(actor)}</b> (${esc(actorEmail)}) ${esc(did)} on ${esc(when)} (Philippine time):`,
            `<span style="display:block;background:#eef5fd;padding:10px 12px;border-radius:8px;"><b>${esc(changeSummary)}</b></span>`,
            `Confirmed with their security PIN and a one-time code. IP address: ${esc(ip)}.`,
            `If you did not expect this, sign in to the admin console, check Audit logs and ${esc(title.replace(/ changed$/, ''))}, and change your password.`,
          ]),
        }, `Integration alert email to ${maskEmail(a.email)}`);
        if (ok) emailed++;
      }
      console.log(`${title} alert emailed to ${emailed} of ${admins.length} admin(s): ${changeSummary}`);
    } catch (err) {
      console.error('Integration alert failed:', err.message);
    }
  });
  return emailOn;
}

/**
 * Tells every active admin about something the server noticed by itself (nobody did it in the admin console),
 * e.g. backend/.env changed: a dashboard alert, plus an email when `email` is given and email is set up.
 * `email.paragraphs` are HTML (escape anything from outside). Never throws: { notified, emailed }.
 */
async function alertAdminsFromServer(message, email = null) {
  try {
    const roles = Object.keys(PERMISSIONS).filter((r) => PERMISSIONS[r].includes('settings'));
    const admins = await User.find({ role: { $in: roles }, isActive: { $ne: false } }).select('firstName email');
    if (admins.length) await Notification.insertMany(admins.map((a) => ({ user: a._id, message: message.slice(0, 1000) })));
    if (!email || !configured.email()) return { notified: admins.length, emailed: 0 };
    let emailed = 0;
    for (const a of admins) {
      const ok = await sendTwice({ to: a.email, subject: email.subject, html: emailHtml(a.firstName, email.paragraphs) },
        `Server alert email to ${maskEmail(a.email)}`);
      if (ok) emailed += 1;
    }
    return { notified: admins.length, emailed };
  } catch (err) {
    console.error('Server alert failed:', err.message);
    return { notified: 0, emailed: 0 };
  }
}

/** Sends a fail() as the JSON error the admin console expects. */
const reply = (res, r) => res.status(r.status || 400).json({ success: false, message: r.message, ...(r.needsPin ? { needsPin: true } : {}) });

module.exports = {
  pinProblem, checkPin, setPin, summary, startChallenge, resendChallenge, useChallenge, challengeView, alertAdmins,
  alertAdminsFromServer, reply,
};
