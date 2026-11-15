/**
 * Tests for the timestamp concurrency control (run: npm test).
 * They need no database: the MongoDB collection of each model is replaced by a small in-memory store
 * that applies filters and updates the way MongoDB does for the cases used here (equality filters,
 * $set / $inc / $setOnInsert), so real Mongoose saves, hooks and the retry wrapper are exercised.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
mongoose.set('bufferCommands', false);

const C = require('../utils/concurrency');
const Booking = require('../models/Booking');
const Court = require('../models/Court');
const handleError = require('../utils/handleError');

/* ---------------- in-memory collection ---------------- */
const same = (a, b) => {
  if (a === null || a === undefined) return b === null || b === undefined; // { f: null } matches missing
  if (a instanceof Date || b instanceof Date) return b != null && new Date(a).getTime() === new Date(b).getTime();
  if (a && a.toString && b && b.toString && (a._bsontype || b._bsontype)) return String(a) === String(b);
  return a === b;
};
const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date) && !v._bsontype && '$in' in v) return v.$in.some((x) => same(x, doc[k]));
  return same(v, doc[k]);
});
const tick = () => new Promise((r) => setImmediate(r)); // lets other "requests" interleave, like real I/O

function memoryCollection(Model) {
  const rows = [];
  const apply = (doc, update) => {
    Object.entries(update.$set || {}).forEach(([k, v]) => { doc[k] = v; });
    Object.entries(update.$inc || {}).forEach(([k, v]) => { doc[k] = (doc[k] || 0) + v; });
    Object.keys(update.$unset || {}).forEach((k) => { delete doc[k]; });
  };
  const coll = Model.collection;
  coll.insertOne = async (doc) => { await tick(); rows.push({ ...doc }); return { acknowledged: true, insertedId: doc._id }; };
  coll.updateOne = async (filter, update) => {
    await tick();
    const doc = rows.find((d) => matches(d, filter)); // check + write happen together, like MongoDB
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    apply(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  };
  coll.findOne = async (filter) => { await tick(); const d = rows.find((x) => matches(x, filter)); return d ? { ...d } : null; };
  coll.deleteOne = async (filter) => { await tick(); const i = rows.findIndex((d) => matches(d, filter)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; };
  return rows;
}

const bookingRows = memoryCollection(Booking);
const courtRows = memoryCollection(Court);
const load = async (Model, rows, id) => Model.hydrate({ ...rows.find((r) => String(r._id) === String(id)) }); // runs the init hook (read phase)

function seedBooking(extra = {}) {
  const b = new Booking({
    user: new mongoose.Types.ObjectId(), court: new mongoose.Types.ObjectId(), courtName: 'Court A',
    date: new Date('2026-12-01T00:00:00+08:00'), startTime: '08:00', endTime: '09:00',
    referenceNumber: `MKI-T-${Math.random().toString(36).slice(2, 8)}`, totalFee: 300, ...extra,
  });
  return b.save().then(() => b);
}

/* ---------------- fake Express req/res ---------------- */
function fakeRes() {
  return {
    locals: {}, headersSent: false, statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; return this; },
  };
}
const fakeReq = (headers = {}, body = {}) => ({ body, get: (h) => headers[h.toLowerCase()] || headers[h] });

/* ================================================================== */

test('timestamps are unique and strictly increasing, even within one millisecond', () => {
  const seen = Array.from({ length: 5000 }, () => C.nextTimestamp().getTime());
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1]);
});

test('a new record gets a write timestamp W-TS', async () => {
  const b = await seedBooking();
  assert.ok(b.writeTS instanceof Date);
  assert.ok(bookingRows.find((r) => String(r._id) === String(b._id)).writeTS);
});

test('save() validates the W-TS it read and advances it', async () => {
  const b = await seedBooking();
  const copy = await load(Booking, bookingRows, b._id);
  const before = copy.writeTS.getTime();
  copy.paymentMethod = 'Cash';
  await copy.save();
  assert.ok(copy.writeTS.getTime() > before, 'W-TS moved forward');
});

test('lost update is prevented: two staff approve/cancel the same booking at the same time', async () => {
  const b = await seedBooking();
  const staff1 = await load(Booking, bookingRows, b._id); // both read the same version
  const staff2 = await load(Booking, bookingRows, b._id);
  staff1.status = 'confirmed';
  staff2.status = 'cancelled';
  const results = await Promise.allSettled([staff1.save(), staff2.save()]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1, 'exactly one write wins');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason.name, 'WriteConflictError');
  assert.equal(failed[0].reason.code, 'WRITE_CONFLICT');
  const stored = bookingRows.find((r) => String(r._id) === String(b._id));
  assert.equal(stored.status, ok[0] === results[0] ? 'confirmed' : 'cancelled', 'the winner is what is stored');
});

test('records written before this feature (no writeTS) are still protected', async () => {
  const b = await seedBooking();
  const row = bookingRows.find((r) => String(r._id) === String(b._id));
  delete row.writeTS; // legacy record
  const a = await load(Booking, bookingRows, b._id);
  const c = await load(Booking, bookingRows, b._id);
  a.paymentMethod = 'GCash'; c.paymentMethod = 'Maya';
  const r = await Promise.allSettled([a.save(), c.save()]);
  assert.equal(r.filter((x) => x.status === 'rejected').length, 1);
});

test('client version (If-Match): a change based on an old screen is refused, not retried', async () => {
  const b = await seedBooking();
  const shownToAdmin = b.writeTS; // admin opened the booking
  const customer = await load(Booking, bookingRows, b._id); // customer cancels meanwhile
  customer.status = 'cancelled';
  await customer.save();

  const current = await load(Booking, bookingRows, b._id);
  const req = fakeReq({ 'if-match': `"${shownToAdmin.toISOString()}"` });
  assert.throws(() => C.assertFresh(req, current, 'booking'), (e) => e.code === 'WRITE_CONFLICT' && e.retryable === false && /changed by someone else/.test(e.message));
  // the same version check passes when the screen is up to date
  C.assertFresh(fakeReq({ 'if-match': `"${current.writeTS.toISOString()}"` }), current, 'booking');
  // and is skipped when the client sent no version (older clients keep working)
  C.assertFresh(fakeReq(), current, 'booking');
});

test('direct updates (updateMany/findOneAndUpdate) also stamp W-TS', async () => {
  let captured;
  const coll = Booking.collection;
  const original = coll.updateMany;
  coll.updateMany = async (filter, update) => { captured = update; return { matchedCount: 0, modifiedCount: 0 }; };
  await Booking.updateMany({ status: 'confirmed' }, { status: 'completed' });
  coll.updateMany = original;
  assert.equal(captured.$set.status, 'completed');
  assert.ok(captured.$set.writeTS instanceof Date);
});

test('court schedule bumps leave the court W-TS alone (admin forms do not go stale)', async () => {
  let captured;
  const coll = Court.collection;
  const original = coll.updateOne;
  coll.updateOne = async (filter, update) => { captured = update; return { matchedCount: 1, modifiedCount: 1 }; };
  await Court.updateOne({ _id: new mongoose.Types.ObjectId(), scheduleTS: null }, { $set: { scheduleTS: C.nextTimestamp() } }, { timestamps: false });
  coll.updateOne = original;
  assert.ok(captured.$set.scheduleTS);
  assert.equal(captured.$set.writeTS, undefined);
});

test('insert-only upserts (Settings.get) do not change W-TS of an existing record', () => {
  const Settings = require('../models/Settings');
  const q = Settings.findOneAndUpdate({ key: 'main' }, { $setOnInsert: { key: 'main' } }, { upsert: true });
  return new Promise((resolve, reject) => {
    Settings.schema.s.hooks.execPre('findOneAndUpdate', q, [], (err) => {
      if (err) return reject(err);
      const u = q.getUpdate();
      try {
        assert.ok(u.$setOnInsert.writeTS, 'new record gets a W-TS');
        assert.ok(!u.$set || !u.$set.writeTS, 'existing record keeps its W-TS');
        resolve();
      } catch (e) { reject(e); }
    });
  });
});

test('schedule timestamp: a booking and a slot block racing on one court -> one is undone', async () => {
  const U = require('../utils/bookingUtils');
  const court = new Court({ name: 'Court A', location: 'Main', pricePerHour: 300 });
  await court.save();

  // two transactions read the court (and its scheduleTS) at the same time
  const forBooking = await load(Court, courtRows, court._id);
  const forBlock = await load(Court, courtRows, court._id);
  const undone = [];
  const outcome = await Promise.allSettled([
    U.commitScheduleOrUndo(forBooking, async () => { undone.push('booking'); }),
    U.commitScheduleOrUndo(forBlock, async () => { undone.push('block'); }),
  ]);
  assert.equal(outcome.filter((o) => o.status === 'fulfilled').length, 1, 'exactly one commits');
  assert.equal(undone.length, 1, 'the other is rolled back');
  const loser = outcome.find((o) => o.status === 'rejected').reason;
  assert.equal(loser.retryable, true, 'and restarted with a new timestamp');
});

test('tx(): a retryable conflict restarts the request with a NEW timestamp', async () => {
  const stamps = [];
  const handler = C.tx(async (req, res) => {
    stamps.push(res.locals.tx.ts.getTime());
    try {
      if (stamps.length < 3) throw new C.WriteConflictError('busy');
      res.json({ success: true });
    } catch (err) { handleError(res, err); } // the routes' own catch blocks look like this
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(stamps.length, 3, 'ran three attempts');
  assert.ok(stamps[1] > stamps[0] && stamps[2] > stamps[1], 'each attempt has a newer TS(T)');
  assert.deepEqual(res.body, { success: true });
});

test('tx(): gives up after MAX_ATTEMPTS with 409 WRITE_CONFLICT', async () => {
  let runs = 0;
  const handler = C.tx(async (req, res) => {
    runs += 1;
    try { throw new C.WriteConflictError('busy'); } catch (err) { handleError(res, err); }
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(runs, C.MAX_ATTEMPTS);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'WRITE_CONFLICT');
});

test('tx(): a stale-screen conflict is answered at once (no retry)', async () => {
  let runs = 0;
  const handler = C.tx(async (req, res) => {
    runs += 1;
    try { throw new C.WriteConflictError('changed by someone else', { retryable: false }); } catch (err) { handleError(res, err); }
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(runs, 1);
  assert.equal(res.statusCode, 409);
});

test('end to end: two concurrent requests read-modify-write one booking -> no update is lost', async () => {
  const b = await seedBooking({ discount: 0 });
  // each request reads the booking, adds 50 to the discount and saves. Without concurrency control both
  // read 0 and both write 50 (one update lost). With it, the second is rejected, restarted, reads 50, writes 100.
  const addDiscount = C.tx(async (req, res) => {
    try {
      const doc = await load(Booking, bookingRows, b._id);
      await tick();
      doc.discount = doc.discount + 50;
      await doc.save();
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });
  const r1 = fakeRes(); const r2 = fakeRes();
  await Promise.all([addDiscount(fakeReq(), r1), addDiscount(fakeReq(), r2)]);
  assert.equal(r1.body.success, true);
  assert.equal(r2.body.success, true);
  assert.equal(bookingRows.find((r) => String(r._id) === String(b._id)).discount, 100);
});
