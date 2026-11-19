/**
 * Tests for the booking rules, cancellation policy and payment settings (utils/policy.js). Run: npm test. No database needed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../utils/policy');

const NOW = new Date('2026-11-20T08:00:00+08:00'); // 8:00 AM in Manila
/** A booking on dateStr at start (Manila), paid ₱400 unless overridden. */
const bk = (dateStr, start, extra = {}) => ({
  date: new Date(`${dateStr}T00:00:00+08:00`), startTime: start, endTime: '23:00', status: 'confirmed', paymentStatus: 'paid', totalFee: 400, ...extra,
});
const rules = (r) => ({ rules: r }); // like a Settings document

test('defaults: no limits, full refunds, the usual payment methods; broken values fall back to them', () => {
  assert.deepEqual(P.rulesOf(null), { ...P.DEFAULTS, paymentMethods: P.DEFAULT_METHODS });
  const r = P.rulesOf(rules({ maxAdvanceDays: -3, lateRefundPercent: 150, cancelCutoffHours: 2.5, paymentMethods: [] }));
  assert.equal(r.maxAdvanceDays, 0);
  assert.equal(r.lateRefundPercent, 100);
  assert.equal(r.cancelCutoffHours, 0);
  assert.deepEqual(r.paymentMethods, P.DEFAULT_METHODS);
});

test('settings check: every problem at once, and only the fields that were sent', () => {
  assert.deepEqual(P.checkSettings({}), { values: {} });
  const ok = P.checkSettings({ maxAdvanceDays: '30', cancelCutoffHours: 24, lateRefundPercent: '', paymentMethods: 'GCash, maya,  Bank   transfer, gcash' });
  assert.deepEqual(ok.values, { maxAdvanceDays: 30, cancelCutoffHours: 24, lateRefundPercent: 0, paymentMethods: ['GCash', 'maya', 'Bank transfer'] });
  const bad = P.checkSettings({ maxAdvanceDays: 400, fullRefundHours: 'two', lateRefundPercent: 50.5, paymentMethods: ' , ', policyNote: 'x'.repeat(501) });
  assert.equal(bad.problems.length, 5);
  assert.match(bad.problems.join('\n'), /How far ahead customers can book must be a whole number of days from 0 to 365/);
  assert.match(bad.problems.join('\n'), /Add at least one payment method/);
  assert.match(bad.problems.join('\n'), /The note for customers can be at most 500 characters/);
});

test('booking rules: minimum notice and how far ahead (Manila dates)', () => {
  const r = rules({ minNoticeHours: 2, maxAdvanceDays: 10 });
  assert.match(P.bookingProblem(r, new Date('2026-11-20T09:30:00+08:00'), NOW), /at least 2 hours before the start/);
  assert.equal(P.bookingProblem(r, new Date('2026-11-20T10:00:00+08:00'), NOW), null);
  assert.equal(P.lastBookableDate(r, NOW), '2026-11-30');
  assert.equal(P.bookingProblem(r, new Date('2026-11-30T21:00:00+08:00'), NOW), null, 'the last day itself is fine');
  assert.match(P.bookingProblem(r, new Date('2026-12-01T06:00:00+08:00'), NOW), /up to 10 days ahead \(until Nov 30, 2026\)/);
  assert.equal(P.bookingProblem(rules({}), new Date('2027-06-01T06:00:00+08:00'), NOW), null, 'no limits by default');
});

test('upcoming bookings per customer', () => {
  assert.equal(P.upcomingProblem(rules({}), 99), null);
  assert.equal(P.upcomingProblem(rules({ maxUpcomingPerCustomer: 3 }), 2), null);
  assert.match(P.upcomingProblem(rules({ maxUpcomingPerCustomer: 3 }), 3), /already have 3 upcoming bookings/);
});

test('cancelling: full refund by default, until the start time', () => {
  const c = P.cancelCheck(rules({}), bk('2026-11-20', '09:00'), NOW);
  assert.deepEqual([c.ok, c.paid, c.refund], [true, true, 400]);
  assert.match(c.rule, /Cancelled 1 hour before the start: full refund/);
  assert.match(P.cancelCheck(rules({}), bk('2026-11-20', '08:00'), NOW).message, /already started/);
  assert.match(P.cancelCheck(rules({}), bk('2026-11-21', '08:00', { status: 'completed' }), NOW).message, /Only pending or confirmed/);
});

test('cancelling: the cut-off, a late refund percentage, no refund at 0%, unpaid and free bookings', () => {
  const r = rules({ cancelCutoffHours: 3, fullRefundHours: 48, lateRefundPercent: 50 });
  assert.match(P.cancelCheck(r, bk('2026-11-20', '10:00'), NOW).message, /up to 3 hours before the start time/);
  const late = P.cancelCheck(r, bk('2026-11-20', '15:00'), NOW);
  assert.deepEqual([late.ok, late.refund], [true, 200]);
  assert.match(late.rule, /Cancelled 7 hours before the start \(under 2 days\): 50% back/);
  const early = P.cancelCheck(r, bk('2026-11-23', '08:00'), NOW);
  assert.equal(early.refund, 400);
  assert.match(early.rule, /Cancelled 3 days before the start: full refund/);
  const none = P.cancelCheck(rules({ fullRefundHours: 24, lateRefundPercent: 0 }), bk('2026-11-20', '20:00'), NOW);
  assert.deepEqual([none.ok, none.paid, none.refund], [true, true, 0]);
  assert.match(none.rule, /no refund$/);
  assert.deepEqual(P.cancelCheck(r, bk('2026-11-20', '15:00', { paymentStatus: 'pending' }), NOW).refund, 0);
  assert.equal(P.cancelCheck(r, bk('2026-11-20', '15:00', { totalFee: 0 }), NOW).paid, false, 'a 100% promo booking has nothing to refund');
});

test('moving a booking: the reschedule cut-off', () => {
  assert.equal(P.rescheduleCheck(rules({ rescheduleCutoffHours: 12 }), bk('2026-11-21', '06:00'), NOW).ok, true);
  assert.match(P.rescheduleCheck(rules({ rescheduleCutoffHours: 12 }), bk('2026-11-20', '19:00'), NOW).message, /up to 12 hours before/);
  assert.match(P.rescheduleCheck(rules({}), bk('2026-11-20', '07:00'), NOW).message, /already started/);
});

test('what customers read', () => {
  const d = P.describe(rules({}));
  assert.deepEqual(d.cancellation.slice(0, 2), ['You can cancel any time before your start time.', 'Paid bookings are refunded in full when you cancel.']);
  assert.deepEqual(d.booking, ['Every booking is confirmed once the facility approves it.']);
  assert.deepEqual(d.payment, ['Accepted: GCash, Maya, Bank transfer, Card, Other.']);
  const s = P.describe(rules({ maxAdvanceDays: 30, minNoticeHours: 2, cancelCutoffHours: 24, fullRefundHours: 72, lateRefundPercent: 50, rescheduleCutoffHours: 6,
    policyNote: 'No-shows are not refunded.', paymentMethods: ['GCash'], paymentInstructions: 'GCash 0917 000 0000 (MAKI)' }));
  assert.deepEqual(s.booking.slice(0, 2), ['You can book up to 30 days ahead.', 'Book at least 2 hours before your start time.']);
  assert.equal(s.cancellation[0], 'Cancel up to 1 day before your start time. After that, please contact the facility.');
  assert.equal(s.cancellation[1], 'Full refund if you cancel at least 3 days before your start time; 50% back after that.');
  assert.match(s.cancellation[2], /Move a booking up to 6 hours before/);
  assert.equal(s.cancellation.at(-1), 'No-shows are not refunded.');
  assert.deepEqual(s.payment, ['Accepted: GCash.', 'GCash 0917 000 0000 (MAKI)']);
  // a cut-off at or after the full-refund time: every allowed cancellation is early enough for a full refund
  assert.equal(P.describe(rules({ cancelCutoffHours: 48, fullRefundHours: 24, lateRefundPercent: 0 })).cancellation[1], 'Paid bookings are refunded in full when you cancel.');
});
