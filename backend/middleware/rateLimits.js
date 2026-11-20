/**
 * Rate limits for the whole API (express-rate-limit), set in backend/.env:
 *   RATE_LIMIT_AUTH    sign-in, sign-up, password reset, Google sign-in       per IP address            default 30/15m
 *   RATE_LIMIT_API     every other /api request                               per account, else per IP  default 300/1m
 *   RATE_LIMIT_CREATE  making bookings, payment proofs, payment links,        per account, else per IP  default 20/10m
 *                      feedback, support messages, broadcasts, announcements
 * Format: <requests>/<window>, the window in s, m or h (30/15m, 300/1m, 1000/1h); "off" turns one off.
 *
 * Signed-in people are counted by account (a whole school's shared Wi-Fi is not one bucket), everyone else by IP
 * address (IPv6 by its /64 network, which one device can hold). Over the limit: 429 with Retry-After, the standard RateLimit headers and a JSON message.
 * GET /api/rate-limit tells the caller where they stand (it is not counted itself). Admins see the limits and who
 * hit them under Security -> Login security; a sign-in flood also alerts them.
 * Counts live in the server's memory: they start over when it restarts, and each server process counts on its own.
 */
const net = require('net');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const DEFAULTS = { auth: '30/15m', api: '300/1m', create: '20/10m' };
const ENV_KEYS = { auth: 'RATE_LIMIT_AUTH', api: 'RATE_LIMIT_API', create: 'RATE_LIMIT_CREATE' };
const LABELS = { auth: 'Sign-in and sign-up', api: 'All other requests', create: 'Creating bookings, payments, feedback and messages' };
const MESSAGES = {
  auth: 'Too many sign-in attempts from your network.',
  api: 'Too many requests.',
  create: 'You are doing that too often.',
};
// routes that create something (bookings that hold a slot, messages that reach people)
const CREATE_ROUTES = [
  '/api/bookings',
  '/api/feedback', '/api/issues', '/api/issues/:id/reply',
  '/api/admin/notifications', '/api/admin/announcements',
];
const UNITS = { s: 1, m: 60, h: 3600 };

/** "30/15m" -> { limit: 30, windowMs: 900000 }, "off" -> null, '' -> null. Throws a plain message for anything else. */
function parseLimit(text) {
  const raw = String(text == null ? '' : text).trim().toLowerCase();
  if (!raw || raw === 'off') return null;
  const m = /^(\d+)\s*\/\s*(\d*)\s*(s|m|h)$/.exec(raw);
  if (!m) throw new Error('should look like 30/15m (requests per window in s, m or h), or off');
  const limit = Number(m[1]);
  const size = m[2] ? Number(m[2]) : 1;
  if (limit < 1 || size < 1) throw new Error('needs at least 1 request in a window of at least 1 second');
  return { limit, windowMs: size * UNITS[m[3]] * 1000 };
}

/** TRUST_PROXY: how many proxies are in front of the server (so req.ip is the visitor), or Express's own names. */
function trustProxySetting(text) {
  const raw = String(text == null ? '' : text).trim().toLowerCase();
  if (!raw || raw === 'false' || raw === '0') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') return true; // trusts any X-Forwarded-For (the settings check warns about it)
  return raw; // loopback, uniquelocal, or addresses/subnets
}

/** IPv4 as it is; IPv6 by its /64 network. */
function ipKey(ip) {
  const a = String(ip || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (!net.isIPv6(a)) return a || 'unknown';
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** The account behind a valid sign-in token, or null (a bad or expired token counts as none). Checked once per request. */
function accountOf(req) {
  if (req.rateLimitAccount !== undefined) return req.rateLimitAccount;
  let id = null;
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Bearer ')) {
    try { const d = jwt.verify(h.slice(7), process.env.JWT_SECRET); id = d && d.id ? String(d.id) : null; } catch (err) { id = null; }
  }
  req.rateLimitAccount = id;
  return id;
}
const byIp = (req) => `ip:${ipKey(req.ip)}`;
const byAccount = (req) => { const id = accountOf(req); return id ? `user:${id}` : byIp(req); };

const human = (s) => (s < 60 ? `${s} second${s === 1 ? '' : 's'}` : s < 3600 ? `${Math.ceil(s / 60)} minute${Math.ceil(s / 60) === 1 ? '' : 's'}` : `${Math.ceil(s / 3600)} hour${Math.ceil(s / 3600) === 1 ? '' : 's'}`);
const per = (spec) => {
  const s = spec.windowMs / 1000;
  return s % 3600 === 0 ? `${s / 3600 === 1 ? '' : `${s / 3600} `}hour${s / 3600 === 1 ? '' : 's'}`
    : s % 60 === 0 ? `${s / 60 === 1 ? '' : `${s / 60} `}minute${s / 60 === 1 ? '' : 's'}` : `${s} seconds`;
};

/**
 * Builds the limiters from an environment ({ RATE_LIMIT_API: '300/1m', ... }). Bad values fall back to the default
 * (the settings check, utils/envCheck.js, tells the admins). `onBlocked(event)` hears about each refused request.
 */
function createRateLimits(env = process.env, { onBlocked = null } = {}) {
  const specs = {};
  const source = {};
  for (const name of Object.keys(DEFAULTS)) {
    const given = String(env[ENV_KEYS[name]] == null ? '' : env[ENV_KEYS[name]]).trim();
    try {
      specs[name] = parseLimit(given || DEFAULTS[name]);
      source[name] = given ? 'backend/.env' : 'default';
    } catch (err) {
      specs[name] = parseLimit(DEFAULTS[name]);
      source[name] = 'default (the value in backend/.env is not valid)';
      console.error(`${ENV_KEYS[name]} ${err.message}: using ${DEFAULTS[name]}`);
    }
  }

  const blocked = new Map(); // `${name}|${key}` -> { name, key, path, count, firstAt, lastAt, until }
  const note = (name, key, req, until) => {
    const id = `${name}|${key}`;
    const now = Date.now();
    for (const [k, e] of blocked) if (now - e.lastAt > 24 * 3600e3) blocked.delete(k); // keep one day
    const e = blocked.get(id) || { name, key, count: 0, firstAt: now };
    Object.assign(e, { count: e.count + 1, lastAt: now, path: `${req.method} ${req.originalUrl.split('?')[0]}`.slice(0, 120), until });
    blocked.set(id, e);
    if (blocked.size > 500) blocked.delete(blocked.keys().next().value);
    if (onBlocked) {
      try { onBlocked({ ...e, first: e.count === 1 }); } catch (err) { /* never get in the way of the answer */ }
    }
  };

  const make = (name, keyGenerator, skip) => {
    const spec = specs[name];
    if (!spec) return null;
    const prop = `rateLimit_${name}`;
    return rateLimit({
      windowMs: spec.windowMs,
      limit: spec.limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      requestPropertyName: prop,
      keyGenerator,
      skip,
      handler: (req, res) => {
        const info = req[prop] || {};
        const reset = info.resetTime ? new Date(info.resetTime).getTime() : Date.now() + spec.windowMs;
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        note(name, keyGenerator(req), req, new Date(reset));
        res.set('Retry-After', String(retryAfter));
        res.status(429).json({ success: false, code: 'RATE_LIMITED', limit: name, retryAfter, message: `${MESSAGES[name]} Try again in ${human(retryAfter)}.` });
      },
    });
  };
  const limiters = {
    auth: make('auth', byIp),
    // auth has its own limit, and the status endpoint is free to ask
    api: make('api', byAccount, (req) => /^\/api\/auth\//.test(req.originalUrl)
      || (req.method === 'GET' && req.originalUrl.split('?')[0] === '/api/rate-limit')),
    create: make('create', byAccount),
  };

  /** Where the caller stands with each limit (GET /api/rate-limit). */
  async function status(req) {
    const out = [];
    for (const name of ['api', 'create', 'auth']) {
      const spec = specs[name];
      const base = { name, label: LABELS[name], countedBy: name === 'auth' || !accountOf(req) ? 'ip address' : 'account' };
      if (!spec) { out.push({ ...base, off: true }); continue; }
      const info = await limiters[name].getKey(name === 'auth' ? byIp(req) : byAccount(req));
      const used = info ? info.totalHits : 0;
      out.push({ ...base, limit: spec.limit, windowSeconds: spec.windowMs / 1000, used, remaining: Math.max(0, spec.limit - used), resetsAt: info && info.resetTime ? info.resetTime : null });
    }
    return out;
  }

  /** Everything the admin console shows: the limits and who hit them in the last day. */
  function adminView() {
    return {
      limits: Object.keys(DEFAULTS).map((name) => ({
        name, label: LABELS[name], setting: ENV_KEYS[name], source: source[name], off: !specs[name],
        ...(specs[name] ? { limit: specs[name].limit, windowSeconds: specs[name].windowMs / 1000, per: per(specs[name]) } : {}),
        countedBy: name === 'auth' ? 'IP address' : 'account, or IP address when not signed in',
      })),
      blocked: [...blocked.values()].sort((a, b) => b.lastAt - a.lastAt).map((e) => ({
        limit: e.name, key: e.key, path: e.path, count: e.count, firstAt: new Date(e.firstAt), lastAt: new Date(e.lastAt), until: e.until,
      })),
    };
  }

  /** Puts the limits in front of the routes. Call before the API routers are mounted. */
  function mount(app) {
    if (limiters.auth) app.use('/api/auth', limiters.auth);
    if (limiters.api) app.use('/api', limiters.api);
    if (limiters.create) app.post(CREATE_ROUTES, limiters.create);
    app.get('/api/rate-limit', async (req, res) => {
      try { res.json({ success: true, limits: await status(req) }); } catch (err) { res.status(500).json({ success: false, message: 'Could not read the rate limits' }); }
    });
  }

  return { specs, limiters, mount, status, adminView, blocked };
}

/* ---------- the server's own limits, and what happens when someone hits one ---------- */
let current = null;
const alerted = new Map(); // `${limit}|${key}` -> when the admins were last told

/** Audit log entry (and, for a sign-in flood, a dashboard alert for every admin) at most once an hour per person/address. */
async function reportBlocked(e) {
  if (mongoose.connection.readyState !== 1) return;
  const id = `${e.name}|${e.key}`;
  const last = alerted.get(id) || 0;
  if (Date.now() - last < 3600e3) return;
  alerted.set(id, Date.now());
  if (alerted.size > 1000) alerted.delete(alerted.keys().next().value);
  const User = require('../models/User');
  const AuditLog = require('../models/AuditLog');
  const who = e.key.startsWith('user:')
    ? await User.findById(e.key.slice(5)).select('firstName lastName role').lean().then((u) => (u ? `${u.firstName} ${u.lastName} (${u.role})` : 'an account'), () => 'an account')
    : `IP address ${e.key.slice(3)}`;
  const spec = current && current.specs[e.name];
  const what = `${LABELS[e.name]} rate limit reached by ${who}${spec ? ` (${spec.limit} per ${per(spec)})` : ''}, on ${e.path}`;
  AuditLog.create({
    actorName: 'Server', actorRole: 'system', action: 'Rate limit reached', detail: `${what}. Blocked until ${new Date(e.until).toISOString()}.`,
    path: e.path.split(' ')[1] || '', method: e.path.split(' ')[0] || '', ip: e.key.startsWith('ip:') ? e.key.slice(3) : '', statusCode: 429,
  })
    .catch((err) => console.error('Audit log failed:', err.message));
  if (e.name === 'auth') {
    const until = new Date(e.until).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
    const { alertAdminsFromServer } = require('../utils/twoStep');
    await alertAdminsFromServer(`Possible password guessing: ${what}. Sign-in is blocked from there until ${until}. See Security, Login security.`);
  }
}

/** Called once by server.js. */
function setup(app) {
  current = createRateLimits(process.env, { onBlocked: (e) => { reportBlocked(e).catch((err) => console.error('Rate limit report failed:', err.message)); } });
  current.mount(app);
  return current;
}

/** For the admin console (null before setup). */
const view = () => (current ? current.adminView() : null);

module.exports = { createRateLimits, setup, view, parseLimit, trustProxySetting, ipKey, DEFAULTS, ENV_KEYS, CREATE_ROUTES };
