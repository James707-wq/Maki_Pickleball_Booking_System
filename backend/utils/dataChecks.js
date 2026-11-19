/**
 * AF-139 Data management: checks that the stored records agree with each other, and fixes the ones that can be
 * fixed safely. Each check: { id, title, why, fixLabel (null = look only) } with find() -> records and fix(records).
 * Plus old records that can be cleaned up, and what MongoDB removes by itself.
 */
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Transaction = require('../models/Transaction');
const Promotion = require('../models/Promotion');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Court = require('../models/Court');
const U = require('./bookingUtils');

const SAMPLE = 5;
const refsOf = (list) => list.slice(0, SAMPLE).map((b) => b.referenceNumber || b.code || String(b._id));
const PAID = { paymentStatus: { $in: ['paid', 'refunded'] }, totalFee: { $gt: 0 } };

/** Bookings among `list` with no transaction of `type`. */
async function withoutTransaction(list, type) {
  if (!list.length) return [];
  const have = new Set((await Transaction.distinct('booking', { type, booking: { $in: list.map((b) => b._id) } })).map(String));
  return list.filter((b) => !have.has(String(b._id)));
}

const CHECKS = [
  {
    id: 'refunded-without-record',
    title: 'Cancelled bookings marked "refunded" with no refund recorded',
    why: 'Before this was fixed, a customer cancelling a paid booking marked it refunded at once, before any money went back. '
      + 'So it never reached Payments -> Refunds and no refund was written to Transaction history.',
    fixLabel: 'Move them to Payments -> Refunds',
    fixDone: (n) => `${n} booking(s) moved to Payments -> Refunds -> Ready to refund. Record there what was given back.`,
    find: () => Booking.find({ paymentStatus: 'refunded', status: { $in: ['cancelled', 'rejected'] }, 'refund.at': null }).select('referenceNumber').lean(),
    fix: async (list) => {
      const r = await Booking.updateMany(
        { _id: { $in: list.map((b) => b._id) }, paymentStatus: 'refunded', 'refund.at': null },
        { $set: { paymentStatus: 'paid' }, $unset: { refund: '' } }
      );
      return r.modifiedCount;
    },
  },
  {
    id: 'paid-missing-transaction',
    title: 'Paid bookings missing from Transaction history',
    why: 'A payment that was never written to Transaction history is left out of Revenue analytics and the Transactions report.',
    fixLabel: 'Add the missing payments',
    fixDone: (n) => `${n} payment(s) added to Transaction history.`,
    find: async () => withoutTransaction(await Booking.find(PAID).select('referenceNumber user courtName totalFee paymentMethod paidAt verifiedAt updatedAt').lean(), 'payment'),
    fix: async (list) => {
      let n = 0;
      for (const b of list) {
        if (await Transaction.exists({ booking: b._id, type: 'payment' })) continue;
        await Transaction.create({ booking: b._id, user: b.user, referenceNumber: b.referenceNumber, courtName: b.courtName, type: 'payment', amount: b.totalFee,
          method: b.paymentMethod || '', note: 'Added by Data checks', createdAt: b.paidAt || b.verifiedAt || b.updatedAt });
        n += 1;
      }
      return n;
    },
  },
  {
    id: 'refund-missing-transaction',
    title: 'Recorded refunds missing from Transaction history',
    why: 'A refund that is not in Transaction history makes the net income in Revenue analytics too high.',
    fixLabel: 'Add the missing refunds',
    fixDone: (n) => `${n} refund(s) added to Transaction history.`,
    find: async () => withoutTransaction(await Booking.find({ paymentStatus: 'refunded', totalFee: { $gt: 0 }, 'refund.at': { $ne: null } })
      .select('referenceNumber user courtName totalFee refund paymentMethod').lean(), 'refund'),
    fix: async (list) => {
      let n = 0;
      for (const b of list) {
        if (await Transaction.exists({ booking: b._id, type: 'refund' })) continue;
        await Transaction.create({ booking: b._id, user: b.user, referenceNumber: b.referenceNumber, courtName: b.courtName, type: 'refund',
          amount: (b.refund && b.refund.amount) || b.totalFee, method: (b.refund && b.refund.method) || b.paymentMethod || '',
          note: `Added by Data checks${b.refund && b.refund.reason ? `: ${b.refund.reason}` : ''}`.slice(0, 200), createdAt: b.refund.at });
        n += 1;
      }
      return n;
    },
  },
  {
    id: 'finished-not-updated',
    title: 'Finished bookings not marked completed or expired yet',
    why: 'Bookings are tidied up whenever someone opens a booking list. Until then, a finished booking still shows as confirmed, '
      + 'and one never approved still shows as pending.',
    fixLabel: 'Tidy them up now',
    fixDone: (n) => `${n} booking(s) marked completed or expired.`,
    find: async () => {
      const now = new Date();
      const list = await Booking.find({ status: { $in: ['confirmed', 'pending'] }, date: { $lte: now } }).select('referenceNumber status date startTime endTime').lean();
      return list.filter((b) => (b.status === 'confirmed' ? U.endInstant(b) : U.startInstant(b)) <= now);
    },
    fix: async (list) => {
      await U.autoCompleteBookings();
      return Booking.countDocuments({ _id: { $in: list.map((b) => b._id) }, status: { $in: ['completed', 'cancelled'] } });
    },
  },
  {
    id: 'promo-usage',
    title: 'Promo codes whose "times used" does not match the bookings',
    why: 'A promo with a usage limit stops working when "times used" reaches it, so a wrong count can block it early or let it run over.',
    fixLabel: 'Recount them',
    fixDone: (n) => `${n} promo code(s) recounted.`,
    find: async () => {
      const promos = await Promotion.find().select('code usedCount').lean();
      if (!promos.length) return [];
      const used = Object.fromEntries((await Booking.aggregate([
        { $match: { promoCode: { $in: promos.map((p) => p.code) } } }, { $group: { _id: '$promoCode', n: { $sum: 1 } } },
      ])).map((x) => [x._id, x.n]));
      return promos.filter((p) => (p.usedCount || 0) !== (used[p.code] || 0)).map((p) => ({ ...p, actual: used[p.code] || 0 }));
    },
    fix: async (list) => {
      let n = 0;
      for (const p of list) {
        const actual = await Booking.countDocuments({ promoCode: p.code });
        const r = await Promotion.updateOne({ _id: p._id }, { $set: { usedCount: actual } });
        n += r.modifiedCount;
      }
      return n;
    },
  },
  {
    id: 'orphan-customer',
    title: 'Bookings whose customer account no longer exists',
    why: 'They still count in reports and analytics (as "Deleted user"). Nothing to fix automatically: deactivate accounts instead of deleting them.',
    fixLabel: null,
    find: async () => {
      const ids = await Booking.distinct('user');
      const exist = new Set((await User.find({ _id: { $in: ids } }).distinct('_id')).map(String));
      const gone = ids.filter((id) => id && !exist.has(String(id)));
      return gone.length ? Booking.find({ user: { $in: gone } }).select('referenceNumber').lean() : [];
    },
  },
  {
    id: 'orphan-court',
    title: 'Bookings on a court that no longer exists',
    why: 'They keep the court name they were booked with. Nothing to fix automatically.',
    fixLabel: null,
    find: async () => {
      const ids = await Booking.distinct('court');
      const exist = new Set((await Court.find({ _id: { $in: ids } }).distinct('_id')).map(String));
      const gone = ids.filter((id) => id && !exist.has(String(id)));
      return gone.length ? Booking.find({ court: { $in: gone } }).select('referenceNumber').lean() : [];
    },
  },
];

/** Runs every check: [{ id, title, why, count, examples, fixLabel }] */
async function runAll() {
  const out = [];
  for (const c of CHECKS) {
    const found = await c.find();
    out.push({ id: c.id, title: c.title, why: c.why, count: found.length, examples: refsOf(found), fixLabel: c.fixLabel });
  }
  return out;
}

/** Fixes what one check finds right now. Returns { fixed, message }. */
async function fix(id) {
  const c = CHECKS.find((x) => x.id === id);
  if (!c) return { error: 'Unknown check', status: 404 };
  if (!c.fixLabel) return { error: 'This one can only be looked at, not fixed automatically', status: 400 };
  const found = await c.find();
  if (!found.length) return { fixed: 0, message: 'Nothing to fix: it was already fixed.' };
  const fixed = await c.fix(found);
  return { fixed, message: c.fixDone(fixed), examples: refsOf(found) };
}

/* ---------------- old records ---------------- */
const NOTIFICATION_DAYS = 90;
const CLEANUPS = [
  {
    id: 'read-notifications',
    title: `Read notifications older than ${NOTIFICATION_DAYS} days`,
    why: 'Customers and staff have already read them. Unread ones are always kept.',
    filter: () => ({ read: true, createdAt: { $lt: new Date(Date.now() - NOTIFICATION_DAYS * 864e5) } }),
    model: Notification,
  },
];
async function cleanupView() {
  return Promise.all(CLEANUPS.map(async (c) => ({ id: c.id, title: c.title, why: c.why, count: await c.model.countDocuments(c.filter()) })));
}
async function cleanup(id) {
  const c = CLEANUPS.find((x) => x.id === id);
  if (!c) return { error: 'Unknown clean-up', status: 404 };
  const r = await c.model.deleteMany(c.filter());
  return { deleted: r.deletedCount || 0 };
}

/** What MongoDB removes by itself (TTL indexes on the models). */
const AUTOMATIC = [
  'Sign-in history: kept 180 days',
  'Custom API (webhook) log: kept 30 days',
  'Sessions: kept 30 days after they end',
  'One-time security codes: kept 1 day',
];

/** How many records each part has, and how big the database is. */
async function overview() {
  const { parts } = require('./backup');
  const db = mongoose.connection.db;
  const counts = [];
  for (const p of parts()) counts.push({ name: p.name, label: p.label, count: await db.collection(p.name).estimatedDocumentCount() });
  let dataSize = null;
  try { dataSize = (await db.stats()).dataSize; } catch (err) { /* not allowed on some hosted plans */ }
  return { counts, dataSize };
}

module.exports = { CHECKS, runAll, fix, CLEANUPS, cleanupView, cleanup, AUTOMATIC, overview };
