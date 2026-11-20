/**
 * Server settings check (backend/.env): tells the admins when it changes, and when a value can't work.
 *
 *  - At start-up: what changed since the previous start (a service that became set up or stopped being set up,
 *    keys added, changed or removed) and values that can't work, e.g. a client secret pasted where the client ID
 *    belongs. Each admin gets a dashboard notification and an email (when email is set up), and it goes into the
 *    audit log. A problem is reported once, until it is fixed.
 *  - While running: when the file is edited, the admins are told which keys changed and that the server keeps
 *    using its old values until it is restarted (dashboard notification).
 * Values are never stored, sent or shown, only key names. To tell whether a value changed, the database keeps a
 * salted scrypt fingerprint of it (models/EnvState.js).
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const EnvState = require('../models/EnvState');
const AuditLog = require('../models/AuditLog');
const { configured, LABELS } = require('./integrations');

const ENV_FILE = path.join(__dirname, '..', '.env');

/* ---------- checks: '' when a value can work, otherwise what is wrong with it ---------- */
function url(v) {
  try { return ['http:', 'https:'].includes(new URL(v).protocol) ? '' : 'should start with https:// or http://'; } catch (e) {
    return 'should be a full web address, e.g. https://www.example.com';
  }
}
const noSpaces = (v) => (/\s/.test(v) ? 'has a space or line break in it: copy it again' : '');
const wholeNumber = (v) => (/^\d+$/.test(v) && Number(v) > 0 ? '' : 'must be a whole number above 0');
const port = (v) => (/^\d+$/.test(v) && Number(v) > 0 && Number(v) < 65536 ? '' : 'must be a port number, e.g. 587');
const anything = () => '';

function googleClientId(v) {
  if (/^GOCSPX-/i.test(v)) {
    return 'is a client secret (it starts with GOCSPX-), not a client ID: use the client_id, the value that ends in .apps.googleusercontent.com';
  }
  return /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(v) ? '' : 'should be a client ID ending in .apps.googleusercontent.com';
}

function privateKey(v) {
  const pem = v.replace(/\\n/g, '\n');
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----/.test(pem)) {
    return "should be the service account's whole private_key, from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----";
  }
  try { crypto.createPrivateKey(pem); } catch (e) {
    return "can't be read as a private key: copy the whole private_key again, inside double quotes, with \\n for each line break";
  }
  return '';
}

/** RATE_LIMIT_*: "30/15m" or off (middleware/rateLimits.js reads them the same way). */
function rateLimitSetting(v) {
  try { require('../middleware/rateLimits').parseLimit(v); return ''; } catch (err) { return `${err.message}; the default is used until it is fixed`; }
}

/** TRUST_PROXY: a number of proxies, false, or Express's names and addresses. "true" would let anyone pick their IP address. */
function trustProxy(v) {
  const raw = v.toLowerCase();
  if (raw === 'true') {
    return 'trusts anyone\'s X-Forwarded-For header, so visitors could choose their own IP address and get around rate limits: use the number of proxies in front of the server, e.g. 1';
  }
  if (/^(false|\d+)$/.test(raw)) return '';
  const ok = raw.split(',').map((x) => x.trim()).every((x) => ['loopback', 'linklocal', 'uniquelocal'].includes(x) || net.isIP(x.split('/')[0]));
  return ok ? '' : 'should be the number of proxies in front of the server (e.g. 1), or addresses of trusted proxies';
}

const turnstileKey = (v) =>(/^[0-3]x[0-9A-Za-z_-]{10,}$/.test(v) ? '' : 'should look like 0x4AAAA... (copy it from Cloudflare, Turnstile)');
const emailFrom = (v) => (/^([^<>@]*<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/.test(v)
  ? '' : 'should be an email address, or Name <email@yourdomain.com>');

/**
 * Every key the app reads, with its check. `service` = the integration it sets up (for the admin console);
 * `watch: false` = changes are not reported (only the create-admin script reads it).
 */
const KEYS = {
  MONGO_URI: { check: (v) => (/^mongodb(\+srv)?:\/\/\S+$/.test(v) ? '' : 'should start with mongodb:// or mongodb+srv://') },
  PORT: { check: port },
  NODE_ENV: { check: (v) => (['production', 'development', 'test'].includes(v) ? '' : 'should be production on the live server, or left out while developing') },
  CLIENT_URL: { check: url },
  CORS_ORIGINS: { check: (v) => v.split(',').map((x) => x.trim()).filter(Boolean).map(url).find(Boolean) || '' },
  JWT_SECRET: {
    check: (v) => (v === 'replace-with-a-long-random-secret' ? 'is still the example value from .env.example: use a long random secret'
      : v.length < 32 ? 'is short: use at least 32 random characters' : ''),
  },
  JWT_EXPIRES_IN: { check: (v) => (/^\d+(\.\d+)?\s*[a-z]*$/i.test(v) ? '' : 'should be a length of time such as 7d or 12h') },
  LOGIN_MAX_ATTEMPTS: { check: wholeNumber },
  LOGIN_LOCK_MINUTES: { check: wholeNumber },
  RATE_LIMIT_AUTH: { check: rateLimitSetting },
  RATE_LIMIT_API: { check: rateLimitSetting },
  RATE_LIMIT_CREATE: { check: rateLimitSetting },
  TRUST_PROXY: { check: trustProxy },
  BACKUP_DIR: { check: (v) => (require('./backup').insidePublic(v) ? 'is inside the frontend folder, which anyone can download from: put backups somewhere else' : '') },
  ADMIN_EMAIL: { check: anything, watch: false },
  ADMIN_FIRST_NAME: { check: anything, watch: false },
  ADMIN_LAST_NAME: { check: anything, watch: false },
  ADMIN_PASSWORD: { check: anything, watch: false },
  GOOGLE_CLIENT_ID: { service: 'googleSignIn', check: googleClientId },
  CUSTOM_GOOGLE_CLIENT_ID: {
    service: 'googleSignIn',
    check: (v, all) => googleClientId(v) || (v === all.GOOGLE_CLIENT_ID ? 'is the same as GOOGLE_CLIENT_ID, so customers do not get a client of their own' : ''),
  },
  GOOGLE_CALENDAR_ID: { service: 'googleCalendar', check: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : "should look like an email address (the Calendar ID in the calendar's settings)") },
  GOOGLE_SERVICE_ACCOUNT_EMAIL: { service: 'googleCalendar', check: (v) => (/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(v) ? '' : 'should end in .iam.gserviceaccount.com') },
  GOOGLE_PRIVATE_KEY: { service: 'googleCalendar', check: privateKey },
  TURNSTILE_SITE_KEY: { service: 'turnstile', check: turnstileKey },
  TURNSTILE_SECRET_KEY: { service: 'turnstile', check: (v, all) => turnstileKey(v) || (v === all.TURNSTILE_SITE_KEY ? 'is the same as the site key: copy the secret key' : '') },
  RESEND_API_KEY: { service: 'email', check: (v) => (/^re_\S+$/.test(v) ? '' : 'should start with re_') },
  RESEND_API_URL: { service: 'email', check: url },
  EMAIL_FROM: { service: 'email', check: emailFrom },
  EMAIL_HOST: { service: 'email', check: (v) => (/^[a-z0-9.-]+$/i.test(v) ? '' : "should be only the mail server's name, e.g. smtp.gmail.com (no smtp:// and no port)") },
  EMAIL_PORT: { service: 'email', check: port },
  EMAIL_USER: { service: 'email', check: anything },
  EMAIL_PASS: { service: 'email', check: anything },
};
const WATCHED = Object.keys(KEYS).filter((k) => KEYS[k].watch !== false);
const RETIRED = {
  PAYMONGO_SECRET_KEY: 'Online payment was removed', PAYMONGO_WEBHOOK_SECRET: 'Online payment was removed',
  HITPAY_API_KEY: 'HitPay online payment was removed', HITPAY_SANDBOX: 'HitPay online payment was removed',
  HITPAY_WEBHOOK_SALT: 'HitPay online payment was removed', HITPAY_API_URL: 'HitPay online payment was removed',
  SEMAPHORE_API_KEY: 'SMS was removed', SEMAPHORE_SENDER_NAME: 'SMS was removed', SEMAPHORE_API_URL: 'SMS was removed',
};
const SERVICES = ['googleSignIn', 'googleCalendar', 'turnstile', 'email']; // the ones backend/.env sets up

const sentence = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');

/** Values that can't work: [{ key, service, message }]. `v` = { KEY: value } as the app reads them. */
function findProblems(v) {
  const out = [];
  for (const [key, spec] of Object.entries(KEYS)) {
    if (!v[key]) continue;
    const problem = spec.check(v[key], v);
    if (problem) out.push({ key, service: spec.service || '', message: `${key} ${problem}` });
  }
  const needs = (service, name, keys, result) => {
    const missing = keys.filter((k) => !v[k]);
    if (missing.length && missing.length < keys.length) {
      out.push({ key: missing[0], service, message: `${name} needs ${sentence(keys)}: ${sentence(missing)} ${missing.length === 1 ? 'is' : 'are'} missing, ${result}` });
    }
  };
  needs('googleCalendar', 'Google Calendar', ['GOOGLE_CALENDAR_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'], 'so it stays off');
  needs('turnstile', 'Cloudflare Turnstile', ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'], 'so it stays off');
  if (!v.RESEND_API_KEY) needs('email', 'Email by SMTP', ['EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'], 'so no email is sent');
  if (v.RESEND_API_KEY && !v.EMAIL_FROM && !v.EMAIL_USER) {
    out.push({ key: 'EMAIL_FROM', service: 'email', message: 'Email through Resend needs EMAIL_FROM: an address on the domain you verified with Resend' });
  }
  return out;
}

/** Keys in the file that the app doesn't read: [{ key, note }]. */
const unusedKeys = (fileValues) => Object.keys(fileValues || {}).filter((k) => !KEYS[k]).sort().map((key) => ({ key, note: RETIRED[key] || '' }));

const valuesFrom = (source) => Object.fromEntries(Object.keys(KEYS).map((k) => [k, String(source[k] == null ? '' : source[k]).trim()]));
function readFile(file = ENV_FILE) {
  try { return dotenv.parse(fs.readFileSync(file)); } catch (err) { return null; }
}
const servicesNow = () => Object.fromEntries(SERVICES.map((n) => [n, Boolean(configured[n] && configured[n]())]));

/** A slow, salted fingerprint of a value ('' for none): enough to see that it changed, useless for guessing it. */
const fingerprint = (salt, value) => new Promise((resolve, reject) => {
  if (!value) return resolve('');
  crypto.scrypt(value, salt, 16, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
});

/** What changed between two starts: "Google Calendar is now set up", "GOOGLE_PRIVATE_KEY added"... */
function describeChanges(before, after) {
  const out = [];
  for (const n of SERVICES) {
    const was = before.services ? before.services[n] : undefined;
    if (was === undefined || was === after.services[n]) continue;
    out.push(`${LABELS[n]} is ${after.services[n] ? 'now set up' : 'no longer set up'}`);
  }
  for (const k of WATCHED) {
    const was = before.fingerprints ? before.fingerprints[k] : undefined;
    if (was === undefined) continue; // a key this version only started to watch: nothing to compare with yet
    const is = after.fingerprints[k];
    if (!was && is) out.push(`${k} added`);
    else if (was && !is) out.push(`${k} removed`);
    else if (was !== is) out.push(`${k} changed`);
  }
  return out;
}

/* ---------- what the admin console shows ---------- */
let latest = { checkedAt: null, problems: [], unused: [], lastChanges: [], changedAt: null, pendingRestart: [], pendingProblems: [] };
const view = () => ({ ...latest });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Dashboard alert for every admin (plus email when `emailToo`), the server console and the audit log. Never throws. */
async function tellAdmins({ changes = [], problems = [], edited = [], emailToo = false }) {
  const parts = [];
  if (edited.length) parts.push(`backend/.env was edited (${edited.join('; ')}). The server keeps using its old settings until it is restarted.`);
  if (changes.length) parts.push(`Server settings changed since the last start (backend/.env): ${changes.join('; ')}.`);
  if (problems.length) parts.push(`${problems.length === 1 ? 'A setting' : 'Settings'} in backend/.env won't work: ${problems.map((p) => p.message).join('; ')}.`);
  if (!parts.length) return;
  const message = parts.join(' ');
  console.log(`[server settings] ${message}`);
  const box = (bg, lines) => `<span style="display:block;background:${bg};padding:10px 12px;border-radius:8px;">${lines.map(esc).join('<br>')}</span>`;
  const { alertAdminsFromServer } = require('./twoStep');
  await alertAdminsFromServer(message, emailToo ? {
    subject: changes.length ? 'Server settings changed (backend/.env)' : "A server setting won't work (backend/.env)",
    paragraphs: [
      ...(changes.length ? ['The server started with changed settings in backend/.env:', box('#eef5fd', changes)] : []),
      ...(problems.length ? [`${problems.length === 1 ? 'This setting' : 'These settings'} won't work:`, box('#fdeceb', problems.map((p) => p.message))] : []),
      'Only the names of the settings are sent, never their values. If you did not expect this, check backend/.env on the server and the Integrations page in the admin console.',
    ],
  } : null);
  AuditLog.create({
    actorName: 'Server', actorRole: 'system',
    action: edited.length ? 'Server settings edited (backend/.env)' : 'Server settings checked at start-up (backend/.env)',
    detail: message.slice(0, 1000),
  }).catch((err) => console.error('Audit log failed:', err.message));
}

/** At start-up: compare with the last start, check the values, and tell the admins what is new. */
async function checkAtStartup() {
  const values = valuesFrom(process.env);
  const problems = findProblems(values);
  const unused = unusedKeys(readFile() || {});
  const services = servicesNow();
  const state = await EnvState.findOne({ key: 'main' }).lean();
  const salt = state ? state.salt : crypto.randomBytes(16).toString('hex');
  const fingerprints = {};
  for (const k of WATCHED) fingerprints[k] = await fingerprint(salt, values[k]);
  const changes = state ? describeChanges(state, { services, fingerprints }) : []; // the first start only records how things are
  const reported = new Set((state && state.problems) || []);
  const fresh = problems.filter((p) => !reported.has(p.message));
  const now = new Date();
  try {
    await EnvState.updateOne({ key: 'main' }, { $set: {
      salt, fingerprints, services, problems: problems.map((p) => p.message), checkedAt: now,
      ...(changes.length ? { lastChanges: changes, changedAt: now } : {}),
    } }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err; // another server started at the same moment and recorded it
  }
  latest = {
    ...latest, checkedAt: now, problems, unused,
    lastChanges: changes.length ? changes : (state && state.lastChanges) || [],
    changedAt: changes.length ? now : (state && state.changedAt) || null,
  };
  if (changes.length || fresh.length) await tellAdmins({ changes, problems: fresh, emailToo: true });
  return { first: !state, changes, problems, fresh, unused };
}

/** While running: tell the admins when the file is edited (the new values only apply after a restart). */
function watchFile(file = ENV_FILE, { interval = 2000, settle = 1500 } = {}) {
  const atStart = readFile(file);
  if (!atStart) return null;
  // keys set in the real environment win over the file (dotenv never overrides them), also after a restart
  const fromShell = Object.keys(KEYS).filter((k) => process.env[k] !== undefined && String(process.env[k]) !== String(atStart[k] ?? ''));
  let told = '';
  let timer = null;
  const check = async () => {
    const now = readFile(file);
    if (!now) return;
    const keys = [...new Set([...Object.keys(atStart), ...Object.keys(now)])].sort();
    const edited = keys.map((k) => {
      const was = String(atStart[k] ?? '').trim();
      const is = String(now[k] ?? '').trim();
      if (was === is) return '';
      return `${k} ${!was ? 'added' : !is ? 'removed' : 'changed'}`;
    }).filter(Boolean);
    const afterRestart = { ...now, ...Object.fromEntries(fromShell.map((k) => [k, process.env[k]])) };
    latest.pendingRestart = edited;
    latest.pendingProblems = edited.length ? findProblems(valuesFrom(afterRestart)) : [];
    if (!edited.length) { told = ''; return; } // edited back to how the server started
    const signature = `${edited.join('|')}#${latest.pendingProblems.map((p) => p.message).join('|')}`;
    if (signature === told) return; // nothing new since the last alert
    told = signature;
    await tellAdmins({ edited, problems: latest.pendingProblems });
  };
  const listener = (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return;
    clearTimeout(timer);
    timer = setTimeout(() => check().catch((err) => console.error('backend/.env check failed:', err.message)), settle);
  };
  fs.watchFile(file, { interval }, listener);
  return { check, stop: () => { clearTimeout(timer); fs.unwatchFile(file, listener); } };
}

/** Called once by server.js: the start-up check as soon as the database is connected, then the file watch. */
function start() {
  mongoose.connection.asPromise()
    .then(() => checkAtStartup())
    .catch((err) => console.error('Server settings check failed:', err.message));
  watchFile();
}

module.exports = {
  KEYS, WATCHED, SERVICES, findProblems, unusedKeys, describeChanges, fingerprint, valuesFrom, readFile,
  checkAtStartup, watchFile, start, view,
};
