/**
 * Tests for checking backup files before a restore (utils/backup.js), run with: npm test. No database needed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const B = require('../utils/backup');

const { EJSON } = mongoose.mongo.BSON;
const id = () => new mongoose.Types.ObjectId();
/** A small backup, written and read back exactly like the real files. */
const roundTrip = (doc) => EJSON.parse(EJSON.stringify(doc, { relaxed: false }), { relaxed: false });
const backup = (cols = {}) => roundTrip({
  format: B.FORMAT, version: B.VERSION, createdAt: new Date(),
  collections: { users: [{ _id: id(), email: 'admin@example.com', role: 'admin', isActive: true }, { _id: id(), email: 'c@example.com', role: 'user' }], courts: [{ _id: id(), name: 'Court 1', pricePerHour: 400 }], ...cols },
});

test('a backup made by this app is accepted (numbers keep their exact type when read back)', () => {
  const doc = backup();
  assert.equal(typeof doc.version, 'object', 'canonical Extended JSON reads numbers as BSON values (Int32), not plain numbers');
  const v = B.validate(doc);
  assert.equal(v.problems, undefined);
  assert.deepEqual(v.counts, { users: 2, courts: 1 });
  assert.ok(v.missing.includes('Bookings'), 'parts the file does not have are reported (they are left as they are)');
});

test('files that are not backups, or from a newer app, are refused', () => {
  assert.match(B.validate({ hello: 1 }).problems[0], /not a backup file/);
  assert.match(B.validate({ ...backup(), version: 99 }).problems[0], /newer version/);
  assert.match(B.validate({ ...backup(), version: 'one' }).problems[0], /no valid version/);
  assert.match(B.validate({ ...backup(), collections: [] }).problems.join(), /no records/);
});

test('damaged records, unknown parts and repeated ids are refused before anything is restored', () => {
  const doc = backup();
  assert.match(B.validate({ ...doc, collections: { ...doc.collections, hackers: [] } }).problems.join(), /Unknown part "hackers"/);
  assert.match(B.validate({ ...doc, collections: { ...doc.collections, courts: [{ name: 'no id' }] } }).problems.join(), /Courts: record 1 is damaged/);
  const court = doc.collections.courts[0];
  assert.match(B.validate({ ...doc, collections: { ...doc.collections, courts: [court, { ...court }] } }).problems.join(), /Courts: 1 record\(s\) have the same id/);
});

test('a backup that would lock everyone out is refused', () => {
  const doc = backup();
  assert.match(B.validate({ ...doc, collections: { ...doc.collections, users: [] } }).problems.join(), /no accounts/);
  const noAdmin = doc.collections.users.map((u) => ({ ...u, role: 'user' }));
  assert.match(B.validate({ ...doc, collections: { ...doc.collections, users: noAdmin } }).problems.join(), /no active admin/);
  const offAdmin = doc.collections.users.map((u) => (u.role === 'admin' ? { ...u, isActive: false } : u));
  assert.match(B.validate({ ...doc, collections: { ...doc.collections, users: offAdmin } }).problems.join(), /no active admin/);
});

test('only backup file names are accepted (no paths)', () => {
  assert.equal(B.isName('makis-backup-20261117-020000-auto.json'), true);
  assert.equal(B.isName('makis-backup-20261117-020000-before-restore-2.json'), true);
  assert.equal(B.isName('../.env'), false);
  assert.equal(B.isName('makis-backup-20261117-020000-auto.json/../../x'), false);
  assert.equal(B.isName('makis-backup-20261117-020000-evil.json'), false);
});
