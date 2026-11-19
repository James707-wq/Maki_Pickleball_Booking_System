/**
 * AF-141 Session management / AF-144 Logout: sign-ins are recorded as sessions (models/Session.js).
 *   start()  signs a token that carries the session id (sid) and records where it signed in
 *   check()  run by middleware/auth.js on every request: the session must still be open
 *   end*()   end sessions: their tokens stop working at once
 * Tokens from before sessions existed carry no sid and are refused, so everyone signs in again once.
 */
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Session = require('../models/Session');

const KEEP_DAYS = 30;           // ended and expired sessions stay listed this long
const TOUCH_MS = 5 * 60 * 1000; // "last active" is saved at most this often
const DAY = 864e5;

const ipOf = (req) => String((req && req.ip) || '').replace(/^::ffff:/, '');
const nameOf = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

/** Records a new session for this sign-in and returns its token. portal: 'customer' | 'admin'. */
async function start(req, user, { portal = 'customer', method = 'password' } = {}) {
  const sid = new mongoose.Types.ObjectId();
  const payload = { id: String(user._id), sid: String(sid) };
  if (portal === 'admin') payload.scope = 'admin';
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
  const { exp } = jwt.decode(token);
  const expiresAt = new Date(exp * 1000);
  const ip = ipOf(req);
  await Session.create({
    _id: sid, user: user._id, portal, method, ip, lastSeenIp: ip, lastSeenAt: new Date(),
    userAgent: String((req && req.get && req.get('user-agent')) || '').slice(0, 300),
    expiresAt, purgeAt: new Date(expiresAt.getTime() + KEEP_DAYS * DAY),
  });
  return token;
}

/** Saves "last active" now and then. Never waits and never throws. */
function touch(s, req) {
  if (Date.now() - new Date(s.lastSeenAt).getTime() < TOUCH_MS) return;
  Session.updateOne({ _id: s._id, endedAt: null }, { $set: { lastSeenAt: new Date(), lastSeenIp: ipOf(req) } })
    .catch((err) => console.error('Session update failed:', err.message));
}

/** Is the session of this (verified) token still open? { ok, session } or { ok: false, message }. */
async function check(decoded, req) {
  if (!decoded || !decoded.sid || !mongoose.isValidObjectId(decoded.sid)) {
    return { ok: false, message: 'Please sign in again.' };
  }
  const s = await Session.findById(decoded.sid).lean();
  if (!s || String(s.user) !== String(decoded.id)) return { ok: false, message: 'Your session has ended. Please sign in again.' };
  if (s.endedAt) {
    const why = s.endReason && s.endReason !== 'Signed out' ? ` (${s.endReason.charAt(0).toLowerCase()}${s.endReason.slice(1)})` : '';
    return { ok: false, message: `You were signed out${why}. Please sign in again.` };
  }
  if (new Date(s.expiresAt) <= new Date()) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  touch(s, req);
  return { ok: true, session: s };
}

/** Ends every open session matching `filter`. Returns how many were ended. */
async function end(filter, { reason = 'Signed out', by = null } = {}) {
  const now = new Date();
  const r = await Session.updateMany(
    { ...filter, endedAt: null },
    { $set: { endedAt: now, endReason: reason, endedByName: nameOf(by), purgeAt: new Date(now.getTime() + KEEP_DAYS * DAY) } }
  );
  return r.modifiedCount || 0;
}
const endOne = (id, opts) => end({ _id: id }, opts);
/** All of a person's sessions, except `except` (a session id) when given. */
const endAllFor = (userId, { except = null, before = null, ...opts } = {}) => end({
  user: userId,
  ...(except ? { _id: { $ne: except } } : {}),
  ...(before ? { createdAt: { $lte: before } } : {}),
}, opts);

/** "Edge on Windows", "Chrome on Android", "Safari on iPhone"... */
function describeAgent(ua = '') {
  const s = String(ua);
  const browser = /EdgiOS|EdgA|Edg\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
      : /SamsungBrowser/.test(s) ? 'Samsung Internet'
        : /FxiOS|Firefox\//.test(s) ? 'Firefox'
          : /CriOS|Chrome\//.test(s) ? 'Chrome'
            : /Safari\//.test(s) ? 'Safari'
              : /curl|node|axios|python|PostmanRuntime|insomnia|okhttp/i.test(s) ? 'A script or app' : '';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows' : /Macintosh|Mac OS X/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'Chromebook' : /Linux/.test(s) ? 'Linux' : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}

/** A session as the pages show it (never the token). */
function view(s, currentSid = null, now = new Date()) {
  const expired = !s.endedAt && new Date(s.expiresAt) <= now;
  const u = s.user && s.user.firstName !== undefined ? s.user : null;
  return {
    id: String(s._id),
    portal: s.portal,
    method: s.method,
    device: describeAgent(s.userAgent),
    ip: s.lastSeenIp || s.ip || '',
    signedInIp: s.ip || '',
    signedInAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt,
    active: !s.endedAt && !expired,
    endedAt: s.endedAt || (expired ? s.expiresAt : null),
    endReason: s.endReason || (expired ? 'Expired' : ''),
    endedByName: s.endedByName || '',
    current: currentSid != null && String(s._id) === String(currentSid),
    ...(u ? { user: { id: String(u._id), name: nameOf(u), email: u.email, role: u.role } } : {}),
  };
}

/** Open sessions (not ended, not expired) as a filter. */
const openFilter = (now = new Date()) => ({ endedAt: null, expiresAt: { $gt: now } });

module.exports = { KEEP_DAYS, start, check, end, endOne, endAllFor, describeAgent, view, openFilter, ipOf };
