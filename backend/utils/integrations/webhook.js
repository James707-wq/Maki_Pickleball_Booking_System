/**
 * Custom API (webhook): sends booking events to the facility's own system as signed JSON POSTs.
 *
 * Set up under admin -> Integrations -> Custom API: an address, the events to send and a signing secret
 * (saved sealed in the database, see utils/secretBox.js). Every request carries:
 *   X-Webhook-Id         evt_... (the same on every retry, so the receiver can ignore repeats)
 *   X-Webhook-Event      e.g. booking.approved
 *   X-Webhook-Timestamp  Unix seconds when this try was sent
 *   X-Webhook-Signature  sha256=<hex HMAC-SHA256 of `${timestamp}.${body}`, keyed with the secret>
 *
 * Each event is saved (models/WebhookDelivery) before it is sent, so retries survive a restart.
 * The first try waits a few seconds: a save that is undone in the same request (it clashed with another
 * change to the court's schedule) then sends nothing. Failed tries are repeated after 1 min, 5 min,
 * 30 min, 2 h and 6 h; after that the delivery is marked failed and an admin can send it again.
 */
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const User = require('../../models/User');
const Settings = require('../../models/Settings');
const WebhookDelivery = require('../../models/WebhookDelivery');
const { isActive, status, webhookSettings } = require('./index');
const { open } = require('../secretBox');

/** The events an admin can choose, with the names the admin console shows. */
const EVENTS = {
  'booking.created': 'New booking',
  'booking.approved': 'Approved',
  'booking.rejected': 'Not approved',
  'booking.cancelled': 'Cancelled',
  'booking.rescheduled': 'Moved',
  'booking.completed': 'Completed',
  'booking.paid': 'Paid',
  'booking.refunded': 'Refunded',
  'booking.checked_in': 'Checked in',
};
const TEST_EVENT = 'webhook.test';
const RETRY_MINUTES = [1, 5, 30, 120, 360]; // waits after tries 1-5; try 6 is the last
const FIRST_TRY_DELAY_MS = 3000;
const LEASE_MS = 2 * 60 * 1000; // a try that never finished (server stopped mid-send) is picked up again after this
const TIMEOUT_MS = 10 * 1000;
const FACILITY = "MAKI's PickleBall Court";
const MANILA_MS = 8 * 3600e3;

const newEventId = () => `evt_${crypto.randomBytes(12).toString('hex')}`;
const iso = (d) => (d ? new Date(d).toISOString() : null);
const manilaDate = (d) => (d ? new Date(new Date(d).getTime() + MANILA_MS).toISOString().slice(0, 10) : null);
const dbReady = () => mongoose.connection.readyState === 1;

/* ------------------------------------------------------------------ */
/* What a save changed (called from the Booking model's hooks)         */
/* ------------------------------------------------------------------ */
const FIELDS = ['status', 'paymentStatus', 'date', 'startTime', 'endTime', 'court', 'courtName', 'checkedInAt'];
const MOVE_FIELDS = ['date', 'startTime', 'endTime', 'court', 'courtName'];
const STATUS_EVENTS = { confirmed: 'booking.approved', rejected: 'booking.rejected', cancelled: 'booking.cancelled', completed: 'booking.completed' };
const PAYMENT_EVENTS = { paid: 'booking.paid', refunded: 'booking.refunded' };

/** Comparable values: dates as ISO strings, ids as strings, missing as null. */
function plain(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return String(v._id || v); // an ObjectId, or a populated court
  return v;
}
const valuesOf = (doc) => Object.fromEntries(FIELDS.map((f) => [f, plain(typeof doc.get === 'function' ? doc.get(f) : doc[f])]));
const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f] === undefined ? null : obj[f]]));

/** Booking post('init') and post('save'): remember how the booking looks now. */
function rememberBooking(doc) {
  doc.$locals.webhookFrom = valuesOf(doc);
}

/**
 * Booking pre('save'): the events this save is about to cause, [{ type, verify: { fields, from, to } }].
 * One save can cause several (cancelled + refunded). A customer's reschedule, which also sends the booking
 * back to "pending", is one booking.rescheduled event whose changes include the status.
 */
function bookingChanges(doc) {
  if (doc.isNew) return [{ type: 'booking.created', verify: { created: true } }];
  const from = doc.$locals.webhookFrom || {};
  const to = valuesOf(doc);
  const fields = FIELDS.filter((f) => doc.isModified(f) && from[f] !== to[f]);
  if (!fields.length) return [];
  const types = [];
  if (fields.some((f) => MOVE_FIELDS.includes(f))) types.push('booking.rescheduled');
  if (fields.includes('status') && STATUS_EVENTS[to.status]) types.push(STATUS_EVENTS[to.status]);
  if (fields.includes('paymentStatus') && PAYMENT_EVENTS[to.paymentStatus]) types.push(PAYMENT_EVENTS[to.paymentStatus]);
  if (fields.includes('checkedInAt') && to.checkedInAt) types.push('booking.checked_in');
  const verify = { fields, from: pick(from, fields), to: pick(to, fields) };
  return types.map((type) => ({ type, verify }));
}

/** A change made without a save, which can't be undone: { status: ['confirmed', 'completed'] }. */
function committedChange(pairs) {
  const fields = Object.keys(pairs);
  return {
    final: true,
    fields,
    from: Object.fromEntries(fields.map((f) => [f, plain(pairs[f][0])])),
    to: Object.fromEntries(fields.map((f) => [f, plain(pairs[f][1])])),
  };
}

/* ------------------------------------------------------------------ */
/* The event body                                                      */
/* ------------------------------------------------------------------ */
/** The booking as the receiver sees it. Contact details only when the admin chose to send them. */
function bookingData(b, user, includeContact) {
  const date = manilaDate(b.date);
  let customer = user ? { id: String(user._id), name: `${user.firstName || ''} ${user.lastName || ''}`.trim() } : null;
  if (customer && includeContact) Object.assign(customer, { email: user.email || '', phone: user.phone || '' });
  if (!customer && b.walkIn && b.walkIn.name) { // booked at the desk for someone without an account
    customer = { id: null, name: b.walkIn.name, walkIn: true };
    if (includeContact) Object.assign(customer, { email: '', phone: b.walkIn.phone || '' });
  }
  return {
    id: String(b._id),
    reference: b.referenceNumber,
    status: b.status,
    statusReason: b.statusReason || '',
    court: { id: plain(b.court), name: b.courtName },
    date,
    startTime: b.startTime,
    endTime: b.endTime,
    start: date ? `${date}T${b.startTime}:00+08:00` : null,
    end: date ? `${date}T${b.endTime}:00+08:00` : null,
    totalFee: b.totalFee,
    discount: b.discount || 0,
    promoCode: b.promoCode || '',
    currency: 'PHP',
    paymentStatus: b.paymentStatus,
    paymentMethod: b.paymentMethod || '',
    paidAt: iso(b.paidAt),
    checkedInAt: iso(b.checkedInAt),
    customer,
    createdAt: iso(b.createdAt),
  };
}

/** { status: { from: 'pending', to: 'confirmed' } }, with dates as YYYY-MM-DD. */
function changesView(verify) {
  if (!verify || !verify.fields) return {};
  const show = (f, v) => (f === 'date' ? manilaDate(v) : v);
  return Object.fromEntries(verify.fields.map((f) => [f, { from: show(f, verify.from[f]), to: show(f, verify.to[f]) }]));
}

const eventBody = (eventId, type, data) => JSON.stringify({ id: eventId, type, createdAt: new Date().toISOString(), facility: FACILITY, data });

/* ------------------------------------------------------------------ */
/* Queueing                                                            */
/* ------------------------------------------------------------------ */
/**
 * Saves one booking event for sending, when the custom API is on and the admin chose this event.
 * `booking` is the booking right after the change (a document or a plain object). Never throws.
 */
async function queueBookingEvent(booking, type, verify = null) {
  try {
    if (!dbReady() || !EVENTS[type] || !(await isActive('webhook'))) return;
    const cfg = await webhookSettings();
    if (!cfg.events.includes(type)) return;
    const userId = booking.user && (booking.user._id || booking.user);
    const user = userId ? await User.findById(userId).select('firstName lastName email phone').lean() : null;
    const eventId = newEventId();
    const body = eventBody(eventId, type, { booking: bookingData(booking, user, cfg.includeContact), changes: changesView(verify) });
    const d = await WebhookDelivery.create({
      eventId, type, booking: booking._id, body, verify, nextAttemptAt: new Date(Date.now() + FIRST_TRY_DELAY_MS),
    });
    setTimeout(() => attempt(d._id).catch((err) => console.error('Custom API delivery failed:', err.message)), FIRST_TRY_DELAY_MS + 100);
  } catch (err) {
    console.error(`Custom API: could not queue ${type}:`, err.message);
  }
}

/** All the events one save caused, in order (from the Booking post('save') hook). */
async function queueBookingEvents(doc, events) {
  for (const e of events) await queueBookingEvent(doc, e.type, e.verify);
}

/** For a change made without a save: queueChange(booking, 'booking.paid', { paymentStatus: ['pending', 'paid'] }). */
const queueChange = (booking, type, pairs) => queueBookingEvent(booking, type, committedChange(pairs));

/** Same, for bulk updates that only know the id: the booking is read only when the event will be sent. */
async function queueChangeById(id, type, pairs) {
  try {
    if (!dbReady() || !EVENTS[type] || !(await isActive('webhook'))) return;
    if (!(await webhookSettings()).events.includes(type)) return;
    const b = await Booking.findById(id).lean();
    if (b) await queueBookingEvent(b, type, committedChange(pairs));
  } catch (err) {
    console.error(`Custom API: could not queue ${type}:`, err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Where we may send to                                                */
/* ------------------------------------------------------------------ */
// addresses the live server must never call: its own machine, private networks, cloud metadata, multicast
const PRIVATE = new net.BlockList();
[['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]].forEach(([a, p]) => PRIVATE.addSubnet(a, p, 'ipv4'));
// (no ::ffff:0:0/96 rule: BlockList also checks plain IPv4 addresses against it, so it would match them all)
[['::', 127], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]].forEach(([a, p]) => PRIVATE.addSubnet(a, p, 'ipv6'));

/** The IPv4 address inside an IPv4-mapped IPv6 address (::ffff:127.0.0.1 or ::ffff:7f00:1), or ''. */
function mappedIPv4(ip) {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!hex) return '';
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for loopback, private, link-local and other non-public IP addresses (and anything that isn't an IP). */
function isPrivateAddress(ip) {
  const text = String(ip || '');
  const v4 = net.isIPv6(text) ? mappedIPv4(text) : text;
  if (net.isIPv4(v4)) return PRIVATE.check(v4, 'ipv4');
  if (net.isIPv6(text)) return PRIVATE.check(text, 'ipv6');
  return true;
}

const strict = () => process.env.NODE_ENV === 'production';

/** What is wrong with an address the admin typed, or ''. The live server needs https. */
function addressProblem(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'Enter the address of your system';
  if (text.length > 500) return 'That address is too long';
  let u;
  try { u = new URL(text); } catch (e) { return 'Enter the full address, starting with https://'; }
  if (!['https:', 'http:'].includes(u.protocol)) return 'The address must start with https://';
  if (u.username || u.password) return 'Leave the user name and password out of the address: the signature already proves each request came from you.';
  if (strict() && u.protocol !== 'https:') return 'Use an https:// address on the live server';
  return '';
}

/** Throws when the address can't be used. On the live server it must also lead to a public host. */
async function checkAddress(raw) {
  const problem = addressProblem(raw);
  if (problem) throw new Error(problem);
  if (!strict()) return; // while developing, a receiver on this computer is fine
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!ips.length || ips.some(isPrivateAddress)) throw new Error('That address leads into a private network. Use a public https address.');
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */
/** The X-Webhook-Signature value: HMAC-SHA256 of `${timestamp}.${body}`. */
const sign = (secret, timestamp, body) => `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

/** Reads at most `max` characters of an answer and drops the rest. */
async function readStart(res, max = 500) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      size += value.length;
    }
  } catch (err) { /* the answer broke off: keep what came */ }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8').slice(0, max);
}

const NETWORK_ERRORS = {
  ECONNREFUSED: 'Connection refused: nothing is listening at that address',
  ENOTFOUND: 'That host name does not exist',
  EAI_AGAIN: 'The host name could not be looked up just now',
  ECONNRESET: 'The connection was cut off',
  ETIMEDOUT: 'The connection timed out',
  CERT_HAS_EXPIRED: "The site's https certificate has expired",
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The site uses a self-signed https certificate',
  SELF_SIGNED_CERT_IN_CHAIN: 'The site uses a self-signed https certificate',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The site's https certificate can't be checked",
  ERR_TLS_CERT_ALTNAME_INVALID: "The site's https certificate is for a different name",
};
function errorText(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return `No answer within ${TIMEOUT_MS / 1000} seconds`;
  const code = (err.cause && err.cause.code) || err.code;
  return NETWORK_ERRORS[code] || (code ? `${err.message} (${code})` : err.message);
}

/** Signs and POSTs one delivery. Never throws: { ok, status, body, error, ms }. */
async function post(url, secret, d) {
  const started = Date.now();
  const done = (r) => ({ status: null, body: '', error: '', ...r, ms: Date.now() - started });
  try {
    await checkAddress(url);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual', // never followed: a redirect counts as a failure
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MAKIs-PickleBall-Webhooks/1.0',
        'X-Webhook-Id': d.eventId,
        'X-Webhook-Event': d.type,
        'X-Webhook-Timestamp': timestamp,
        'X-Webhook-Signature': sign(secret, timestamp, d.body),
      },
      body: d.body,
    });
    const body = await readStart(res);
    if (res.status >= 200 && res.status < 300) return done({ ok: true, status: res.status, body });
    const where = res.headers.get('location');
    const error = res.status >= 300 && res.status < 400
      ? `Redirected${where ? ` to ${where.slice(0, 200)}` : ''}. Save the final address instead.`
      : `Your system answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
    return done({ ok: false, status: res.status, body, error });
  } catch (err) {
    return done({ ok: false, error: errorText(err) });
  }
}

/** Every field the change touched is back to what it was before (`now` from valuesOf). */
const reverted = (verify, now) => verify.fields.every((f) => now[f] === verify.from[f]);

/** Was the change behind an event undone before it was sent (the booking is gone, or back as it was)? */
async function wasUndone(verify, bookingId) {
  if (!verify || verify.final) return false;
  const b = await Booking.findById(bookingId).lean();
  if (!b) return true;
  if (verify.created) return false;
  return reverted(verify, valuesOf(b));
}

/** One try for one saved delivery, when it is due and nobody else is sending it. Returns it after the try. */
async function attempt(id) {
  const now = new Date();
  const d = await WebhookDelivery.findOneAndUpdate(
    { _id: id, status: { $in: ['pending', 'sending'] }, nextAttemptAt: { $lte: now } },
    { $set: { status: 'sending', lastAttemptAt: now, nextAttemptAt: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!d) return null; // done already, not due yet, or another try has it
  const finish = (set) => WebhookDelivery.findByIdAndUpdate(d._id, { $set: set }, { new: true });

  if (!d.test && d.attempts === 1 && d.booking && (await wasUndone(d.verify, d.booking))) {
    return finish({ status: 'skipped', error: 'Not sent: the change was undone a moment later (it clashed with another change).' });
  }
  const w = (await Settings.get()).webhook || {};
  const secret = open(w.secret);
  if (!w.url || !secret) return finish({ status: 'skipped', error: 'Not sent: the custom API has no address or secret.' });
  if (!d.test && !(await isActive('webhook'))) return finish({ status: 'skipped', error: 'Not sent: the custom API is turned off.' });

  const r = await post(w.url, secret, d);
  const result = { responseStatus: r.status, responseBody: r.body, error: r.error, durationMs: r.ms };
  if (r.ok) return finish({ ...result, status: 'delivered', deliveredAt: new Date() });
  const wait = d.test ? undefined : RETRY_MINUTES[d.attempts - 1];
  if (wait === undefined) return finish({ ...result, status: 'failed' });
  return finish({ ...result, status: 'pending', nextAttemptAt: new Date(Date.now() + wait * 60000) });
}

/** Sends a test event now with the saved address and secret (also while switched off). */
async function sendTest() {
  const eventId = newEventId();
  const body = eventBody(eventId, TEST_EVENT, { message: `Test from ${FACILITY}. If you can read this, the custom API works.` });
  const d = await WebhookDelivery.create({ eventId, type: TEST_EVENT, test: true, body });
  return attempt(d._id);
}

/** Sends a failed delivery once more, now. Null when it isn't a failed booking event. */
async function retryDelivery(id) {
  const d = await WebhookDelivery.findOneAndUpdate(
    { _id: id, test: false, status: 'failed' },
    { $set: { status: 'pending', nextAttemptAt: new Date() } },
    { new: true }
  );
  return d ? attempt(d._id) : null;
}

/* ------------------------------------------------------------------ */
/* Background job: first tries a timer missed (restart), and retries   */
/* ------------------------------------------------------------------ */
let busy = false;
async function sendDue() {
  if (busy || !dbReady()) return;
  busy = true;
  try {
    const due = await WebhookDelivery.find({ status: { $in: ['pending', 'sending'] }, nextAttemptAt: { $lte: new Date() } })
      .sort({ nextAttemptAt: 1 }).limit(25).select('_id').lean();
    for (const d of due) await attempt(d._id).catch((err) => console.error('Custom API delivery failed:', err.message));
  } catch (err) {
    console.error('Custom API retry job failed:', err.message);
  } finally {
    busy = false;
  }
}

function startWebhookJob() {
  setTimeout(sendDue, 15 * 1000); // first run once the database is connected
  setInterval(sendDue, 30 * 1000);
}

/* ------------------------------------------------------------------ */
/* For the admin console                                               */
/* ------------------------------------------------------------------ */
/** The saved settings as the admin console may see them (never the secret). */
async function adminView() {
  const w = (await Settings.get()).webhook || {};
  const st = (await status()).webhook;
  return {
    url: w.url || '',
    events: (w.events || []).filter((e) => EVENTS[e]),
    includeContact: Boolean(w.includeContact),
    secretSet: Boolean(w.secret),
    secretReadable: Boolean(open(w.secret)),
    secretHint: w.secretHint || '',
    secretSetAt: w.secretSetAt || null,
    configured: st.configured,
    switchedOn: st.switchedOn,
    active: st.active,
  };
}

const deliveryView = (d) => ({
  id: d._id,
  eventId: d.eventId,
  type: d.type,
  test: Boolean(d.test),
  status: d.status,
  attempts: d.attempts,
  nextAttemptAt: d.status === 'pending' ? d.nextAttemptAt : null,
  lastAttemptAt: d.lastAttemptAt || null,
  deliveredAt: d.deliveredAt || null,
  responseStatus: d.responseStatus ?? null,
  responseBody: d.responseBody || '',
  error: d.error || '',
  durationMs: d.durationMs ?? null,
  createdAt: d.createdAt,
  body: d.body,
});

const recentDeliveries = async (limit = 20) => (await WebhookDelivery.find().sort({ createdAt: -1 }).limit(limit).lean()).map(deliveryView);

/** Booking events that gave up since `since` (shown on the Integrations page). */
const failedSince = (since) => WebhookDelivery.countDocuments({ status: 'failed', test: false, updatedAt: { $gte: since } });

module.exports = {
  EVENTS, TEST_EVENT, RETRY_MINUTES,
  rememberBooking, bookingChanges, committedChange, bookingData, changesView, valuesOf, reverted,
  queueBookingEvent, queueBookingEvents, queueChange, queueChangeById,
  addressProblem, checkAddress, isPrivateAddress, sign, post, attempt, sendTest, retryDelivery,
  sendDue, startWebhookJob, adminView, deliveryView, recentDeliveries, failedSince,
};
