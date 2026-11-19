/**
 * Booking rules (AF-136), the cancellation and refund policy (AF-137) and the payment settings.
 * The admin sets them under Hours & rules; they live in the Settings document (Settings.rules).
 * The customer booking routes enforce them and the customer pages show describe(). Staff are never
 * limited by them: in the admin console they can still book, move and cancel any booking.
 * Every number is a whole number; 0 always means "no limit" (or "until the start time").
 */
const { startInstant, toDateStr, manilaMidnight } = require('./bookingUtils');

const DEFAULT_METHODS = ['GCash', 'Maya', 'Bank transfer', 'Card', 'Other'];

/** name -> [min, max, label for messages, unit] */
const NUMBERS = {
  maxAdvanceDays: [0, 365, 'How far ahead customers can book', 'days'],
  minNoticeHours: [0, 168, 'How long before the start a booking must be made', 'hours'],
  maxUpcomingPerCustomer: [0, 50, 'Upcoming bookings one customer may hold', 'bookings'],
  cancelCutoffHours: [0, 168, 'How long before the start customers can still cancel', 'hours'],
  rescheduleCutoffHours: [0, 168, 'How long before the start customers can still move a booking', 'hours'],
  fullRefundHours: [0, 720, 'How early a cancellation must be for a full refund', 'hours'],
  lateRefundPercent: [0, 100, 'The refund for later cancellations', 'percent'],
};
const TEXTS = { policyNote: 500, paymentInstructions: 600 };
const MAX_METHODS = 10;
const METHOD_LENGTH = 30;

const DEFAULTS = Object.freeze({
  maxAdvanceDays: 0,
  minNoticeHours: 0,
  maxUpcomingPerCustomer: 0,
  cancelCutoffHours: 0,
  rescheduleCutoffHours: 0,
  fullRefundHours: 0, // 0 = every cancellation of a paid booking is refunded in full
  lateRefundPercent: 100,
  policyNote: '',
  paymentMethods: DEFAULT_METHODS,
  paymentInstructions: '',
});

const HOUR = 3600e3;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** 24 -> "1 day", 48 -> "2 days", 5 -> "5 hours" */
const span = (hours) => (hours >= 24 && hours % 24 === 0 ? plural(hours / 24, 'day') : plural(hours, 'hour'));
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;
const fmtDay = (dateStr) => new Date(`${dateStr}T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric' });

/** The rules from a Settings document (or a plain object), with defaults for anything missing or broken. */
function rulesOf(settings) {
  const src = (settings && (settings.rules && typeof settings.rules === 'object' ? settings.rules : settings)) || {};
  const plain = typeof src.toObject === 'function' ? src.toObject() : src;
  const out = {};
  Object.entries(NUMBERS).forEach(([k, [min, max]]) => {
    const v = Number(plain[k]);
    out[k] = Number.isInteger(v) && v >= min && v <= max ? v : DEFAULTS[k];
  });
  Object.keys(TEXTS).forEach((k) => { out[k] = typeof plain[k] === 'string' ? plain[k] : DEFAULTS[k]; });
  const methods = Array.isArray(plain.paymentMethods) ? plain.paymentMethods.map((m) => String(m).trim()).filter(Boolean) : [];
  out.paymentMethods = methods.length ? methods : [...DEFAULT_METHODS];
  return out;
}

/** "GCash, Maya" or ["GCash", "Maya"] -> trimmed list without repeats (first spelling wins). */
function methodList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/);
  const seen = new Set();
  const out = [];
  raw.map((m) => String(m).trim().replace(/\s+/g, ' ')).filter(Boolean).forEach((m) => {
    const key = m.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(m); }
  });
  return out;
}

/**
 * Checks the rule fields an admin sent (only the ones present). Nothing is saved here.
 * Returns { problems: [...] } or { values: { field: value } } ready to save.
 */
function checkSettings(body = {}) {
  const problems = [];
  const values = {};
  Object.entries(NUMBERS).forEach(([k, [min, max, label, unit]]) => {
    if (!(k in body)) return;
    const raw = body[k];
    const v = raw === '' || raw == null ? 0 : Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) {
      problems.push(`${label} must be a whole number of ${unit} from ${min} to ${max}`);
    } else values[k] = v;
  });
  Object.entries(TEXTS).forEach(([k, maxLen]) => {
    if (!(k in body)) return;
    const v = String(body[k] ?? '').trim();
    if (v.length > maxLen) problems.push(`${k === 'policyNote' ? 'The note for customers' : 'The payment instructions'} can be at most ${maxLen} characters (now ${v.length})`);
    else values[k] = v;
  });
  if ('paymentMethods' in body) {
    const list = methodList(body.paymentMethods);
    if (!list.length) problems.push('Add at least one payment method customers can choose, e.g. GCash');
    else if (list.length > MAX_METHODS) problems.push(`List at most ${MAX_METHODS} payment methods`);
    else if (list.some((m) => m.length > METHOD_LENGTH)) problems.push(`Each payment method can be at most ${METHOD_LENGTH} characters`);
    else values.paymentMethods = list;
  }
  return problems.length ? { problems } : { values };
}

/* ---------------- what customers may do ---------------- */

/** The last date customers may book (YYYY-MM-DD, Manila), or null for no limit. */
function lastBookableDate(rules, now = new Date()) {
  const r = rulesOf(rules);
  if (!r.maxAdvanceDays) return null;
  return toDateStr(new Date(manilaMidnight(toDateStr(now)).getTime() + r.maxAdvanceDays * 864e5));
}

/** Why a customer may not book (or move a booking to) a slot starting at `startAt`, or null when they may. */
function bookingProblem(rules, startAt, now = new Date()) {
  const r = rulesOf(rules);
  if (r.minNoticeHours && startAt.getTime() - now.getTime() < r.minNoticeHours * HOUR) {
    return `Bookings must be made at least ${span(r.minNoticeHours)} before the start time. Please choose a later time.`;
  }
  const last = lastBookableDate(r, now);
  if (last && toDateStr(startAt) > last) {
    return `You can book up to ${plural(r.maxAdvanceDays, 'day')} ahead (until ${fmtDay(last)}). Please choose an earlier date.`;
  }
  return null;
}

/** Why a customer already holding `upcoming` bookings may not make another, or null. */
function upcomingProblem(rules, upcoming) {
  const r = rulesOf(rules);
  if (!r.maxUpcomingPerCustomer || upcoming < r.maxUpcomingPerCustomer) return null;
  return `You already have ${plural(upcoming, 'upcoming booking')}, the most one customer can hold at a time. You can book again once one of them has passed or been cancelled.`;
}

/**
 * Can the customer cancel this booking now, and what do they get back?
 * { ok, code?, message?, paid, refund, rule, hoursBefore }
 *   refund: what the policy says the facility gives back (0 when unpaid or not refunded)
 *   rule:   one line staff and customers see, e.g. "Cancelled 5 hours before the start: 50% back"
 */
function cancelCheck(rules, booking, now = new Date()) {
  const r = rulesOf(rules);
  const fail = (message) => ({ ok: false, code: 400, message, paid: false, refund: 0, rule: '' });
  if (!['pending', 'confirmed'].includes(booking.status)) return fail('Only pending or confirmed bookings can be cancelled');
  const left = startInstant(booking).getTime() - now.getTime();
  if (left <= 0) return fail('This booking has already started, so it can no longer be cancelled.');
  if (r.cancelCutoffHours && left < r.cancelCutoffHours * HOUR) {
    return fail(`Bookings can be cancelled up to ${span(r.cancelCutoffHours)} before the start time. Please contact the facility.`);
  }
  const hoursBefore = left / HOUR;
  const fee = Number(booking.totalFee) || 0;
  const paid = booking.paymentStatus === 'paid' && fee > 0;
  if (!paid) return { ok: true, paid: false, refund: 0, rule: '', hoursBefore };
  const when = hoursBefore >= 48 ? `${Math.floor(hoursBefore / 24)} days` : hoursBefore >= 1 ? plural(Math.floor(hoursBefore), 'hour') : 'less than an hour';
  if (!r.fullRefundHours || left >= r.fullRefundHours * HOUR || r.lateRefundPercent >= 100) {
    return { ok: true, paid, refund: fee, rule: `Cancelled ${when} before the start: full refund`, hoursBefore };
  }
  const refund = Math.round((fee * r.lateRefundPercent) / 100);
  const rule = r.lateRefundPercent
    ? `Cancelled ${when} before the start (under ${span(r.fullRefundHours)}): ${r.lateRefundPercent}% back`
    : `Cancelled ${when} before the start (under ${span(r.fullRefundHours)}): no refund`;
  return { ok: true, paid, refund, rule, hoursBefore };
}

/** Can the customer move this booking now? { ok, code?, message? } (the new time is checked with bookingProblem). */
function rescheduleCheck(rules, booking, now = new Date()) {
  const r = rulesOf(rules);
  if (!['pending', 'confirmed'].includes(booking.status)) return { ok: false, code: 400, message: 'Only pending or confirmed bookings can be rescheduled' };
  const left = startInstant(booking).getTime() - now.getTime();
  if (left <= 0) return { ok: false, code: 400, message: 'This booking has already started, so it can no longer be moved.' };
  if (r.rescheduleCutoffHours && left < r.rescheduleCutoffHours * HOUR) {
    return { ok: false, code: 400, message: `Bookings can be moved up to ${span(r.rescheduleCutoffHours)} before the start time. Please contact the facility.` };
  }
  return { ok: true };
}

/** The refund line customers read, e.g. "Full refund if you cancel at least 2 days before; 50% back after that." */
function refundLine(r) {
  const everyCancelIsEarly = r.fullRefundHours && r.cancelCutoffHours >= r.fullRefundHours; // later ones are refused anyway
  if (!r.fullRefundHours || r.lateRefundPercent >= 100 || everyCancelIsEarly) return 'Paid bookings are refunded in full when you cancel.';
  const after = r.lateRefundPercent ? `${r.lateRefundPercent}% back after that` : 'no refund after that';
  return `Full refund if you cancel at least ${span(r.fullRefundHours)} before your start time; ${after}.`;
}

/** Plain-English rules for customers and for the admin's preview: { booking: [...], cancellation: [...], payment: [...] } */
function describe(rules) {
  const r = rulesOf(rules);
  const booking = [];
  if (r.maxAdvanceDays) booking.push(`You can book up to ${plural(r.maxAdvanceDays, 'day')} ahead.`);
  if (r.minNoticeHours) booking.push(`Book at least ${span(r.minNoticeHours)} before your start time.`);
  if (r.maxUpcomingPerCustomer) booking.push(`You can hold up to ${plural(r.maxUpcomingPerCustomer, 'upcoming booking')} at a time.`);
  booking.push('Every booking is confirmed once the facility approves it.');

  const cancellation = [
    r.cancelCutoffHours
      ? `Cancel up to ${span(r.cancelCutoffHours)} before your start time. After that, please contact the facility.`
      : 'You can cancel any time before your start time.',
    refundLine(r),
    r.rescheduleCutoffHours
      ? `Move a booking up to ${span(r.rescheduleCutoffHours)} before its start time. A moved booking needs approval again.`
      : 'You can move a booking to another free time before it starts. A moved booking needs approval again.',
    'If the facility cancels your booking or does not approve it, a payment is refunded in full.',
  ];
  if (r.policyNote) cancellation.push(r.policyNote);

  const payment = [`Accepted: ${r.paymentMethods.join(', ')}.`];
  if (r.paymentInstructions) payment.push(r.paymentInstructions);
  return { booking, cancellation, payment };
}

/** What the customer site gets (GET /api/facility): the numbers it needs plus the readable lines. */
function publicView(rules) {
  const r = rulesOf(rules);
  return { ...r, lastBookableDate: lastBookableDate(r), lines: describe(r) };
}

module.exports = {
  DEFAULTS, DEFAULT_METHODS, NUMBERS, MAX_METHODS, METHOD_LENGTH,
  rulesOf, methodList, checkSettings, lastBookableDate, bookingProblem, upcomingProblem, cancelCheck, rescheduleCheck,
  describe, publicView, span, peso,
};
