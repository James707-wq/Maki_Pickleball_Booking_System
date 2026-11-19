/**
 * API tokens let another system (a spreadsheet, a door panel at the courts, the facility's own app) call /api/v1
 * without a password. Admins make them under Security -> API tokens with their PIN and a one-time code.
 * This file checks a token's settings before anything is saved, makes and recognises tokens, and describes them.
 * A token is "mkp_" + 32 random bytes; only its SHA-256 hash and first characters are kept.
 */
const crypto = require('crypto');
const ApiToken = require('../models/ApiToken');

/** What a token may do. `can` finishes the sentence "This API token may ...". */
const SCOPES = {
  'courts:read': { label: 'See courts and free times', can: 'see courts and their free times' },
  'bookings:read': { label: 'See bookings', can: 'see bookings' },
  'customers:read': { label: "See customers' email and mobile", can: "see customers' email and mobile number in bookings" },
  'checkins:write': { label: 'Check customers in', can: 'check customers in' },
};
const WINDOWS = { minute: 60, hour: 3600, day: 86400 }; // seconds
const EXPIRY_DAYS = [7, 30, 90, 365];
const MAX_ACTIVE = 20;
const MAX_DAYS = 366;
const TOKEN_RE = /^mkp_[A-Za-z0-9_-]{43}$/;
const MANILA_MS = 8 * 3600e3;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
/** A new token, its hash, and the part admins may see again. */
function newToken() {
  const token = `mkp_${crypto.randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const manilaDate = (d) => new Date(new Date(d).getTime() + MANILA_MS).toISOString().slice(0, 10);
const day = (d) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric' });
const sentence = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');
const activeFilter = (now) => ({ revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });

/** The API limit for everyone (RATE_LIMIT_API) right now: { limit, windowSeconds, text } or null when it is off. */
function apiLimitNow() {
  const v = require('../middleware/rateLimits').view();
  const api = v && v.limits.find((l) => l.name === 'api');
  return api && !api.off ? { limit: api.limit, windowSeconds: api.windowSeconds, text: `${api.limit} per ${api.per}` } : null;
}

/** Problems that only another token can cause: the same name, or too many tokens. */
async function clashes(name, now = new Date()) {
  const out = [];
  if (await ApiToken.exists({ name: new RegExp(`^${escapeRegex(name)}$`, 'i'), ...activeFilter(now) })) {
    out.push(`There is already a token called "${name}". Pick another name, or revoke that one first`);
  }
  if ((await ApiToken.countDocuments(activeFilter(now))) >= MAX_ACTIVE) {
    out.push(`There are already ${MAX_ACTIVE} tokens in use. Revoke ones you no longer need first`);
  }
  return out;
}

/**
 * Checks what an admin asked for, before anything is saved: { settings } or { problems } (all of them at once, so the
 * form can show every one). body: { name, scopes: [...], rateLimit: { limit, window }, expires: { days } | { date } | { never: true } }
 */
async function checkSettings(body, { apiLimit = apiLimitNow(), now = new Date() } = {}) {
  const b = body || {};
  const problems = [];

  const name = String(b.name || '').replace(/\s+/g, ' ').trim();
  if (!name) problems.push('Give the token a name, e.g. "Door panel" or "Bookings sheet"');
  else if (name.length > 60) problems.push('The name can be at most 60 characters');

  const asked = Array.isArray(b.scopes) ? b.scopes.map(String) : [];
  const scopes = Object.keys(SCOPES).filter((s) => asked.includes(s));
  if (asked.some((s) => !SCOPES[s])) problems.push('Some of the permissions are not known');
  if (!scopes.length) problems.push('Choose what the token may do');
  if (scopes.includes('customers:read') && !scopes.includes('bookings:read')) {
    problems.push(`"${SCOPES['customers:read'].label}" only works together with "${SCOPES['bookings:read'].label}"`);
  }

  const r = b.rateLimit || {};
  const limit = Number(r.limit);
  const window = String(r.window || '');
  if (!WINDOWS[window]) problems.push('Choose a rate limit per minute, hour or day');
  else if (!Number.isInteger(limit) || limit < 1 || limit > 100000) problems.push('The rate limit must be a whole number from 1 to 100000');
  else if (apiLimit && limit / WINDOWS[window] > apiLimit.limit / apiLimit.windowSeconds) {
    const most = Math.max(1, Math.floor((apiLimit.limit / apiLimit.windowSeconds) * WINDOWS[window]));
    problems.push(`${limit} per ${window} is more than the API allows anyone (${apiLimit.text}): use at most ${most} per ${window}`);
  }

  let expiresAt = null;
  const e = b.expires || {};
  if (e.never === true) expiresAt = null;
  else if (EXPIRY_DAYS.includes(e.days)) expiresAt = new Date(now.getTime() + e.days * 864e5);
  else if (typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
    expiresAt = new Date(`${e.date}T23:59:59.999+08:00`); // the end of that day, Philippine time
    if (Number.isNaN(expiresAt.getTime()) || manilaDate(expiresAt) !== e.date) problems.push('The expiry date is not a real date');
    else if (expiresAt <= now) problems.push('The expiry date must be in the future');
    else if (expiresAt - now > MAX_DAYS * 864e5) problems.push('The expiry date can be at most a year from today');
  } else problems.push('Choose when the token expires');

  if (name && name.length <= 60) problems.push(...(await clashes(name, now)));
  if (problems.length) return { problems };
  return { settings: { name, scopes, rateLimit: { limit, window }, expiresAt } };
}

/** "Make API token "Door panel": check customers in; 20 per minute; expires 17 Feb 2027" */
function describe(s) {
  return `Make API token "${s.name}": ${sentence(s.scopes.map((x) => SCOPES[x].can))}; ${s.rateLimit.limit} per ${s.rateLimit.window}; `
    + `${s.expiresAt ? `expires ${day(s.expiresAt)}` : 'never expires'}`;
}

/** A token for the admin console (never the hash). */
function view(t, now = new Date()) {
  const status = t.revokedAt ? 'revoked' : t.expiresAt && new Date(t.expiresAt) <= now ? 'expired' : 'active';
  return {
    id: String(t._id), name: t.name, prefix: t.prefix, scopes: t.scopes, rateLimit: { limit: t.rateLimit.limit, window: t.rateLimit.window },
    expiresAt: t.expiresAt || null, status, createdAt: t.createdAt, createdByName: t.createdByName || '',
    lastUsedAt: t.lastUsedAt || null, lastUsedIp: t.lastUsedIp || '', revokedAt: t.revokedAt || null, revokedByName: t.revokedByName || '',
  };
}

const scopeList = Object.entries(SCOPES).map(([id, s]) => ({ id, label: s.label, can: s.can }));

module.exports = {
  SCOPES, WINDOWS, EXPIRY_DAYS, MAX_ACTIVE, TOKEN_RE, scopeList,
  hashToken, newToken, checkSettings, clashes, describe, view, apiLimitNow, day,
};
