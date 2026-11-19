/**
 * Tests for the custom API (webhook), run with: npm test
 * No database needed: booking changes are checked on documents built in memory, and deliveries are
 * POSTed to a small receiver on this computer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const mongoose = require('mongoose');

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
mongoose.set('bufferCommands', false);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret'; // the key secretBox derives from

const Booking = require('../models/Booking');
const W = require('../utils/integrations/webhook');
const { seal, open } = require('../utils/secretBox');

const oid = () => new mongoose.Types.ObjectId();
const NOV_20 = new Date('2026-11-19T16:00:00.000Z'); // 20 Nov 2026, midnight in Manila
/** A booking as if it was just read from the database (runs the post('init') hook). */
const loaded = (over = {}) => Booking.hydrate({
  _id: oid(), user: oid(), court: oid(), courtName: 'Court 1', date: NOV_20, startTime: '08:00', endTime: '09:00',
  referenceNumber: 'MKI-TEST-1', totalFee: 400, status: 'pending', paymentStatus: 'pending', ...over,
});
const types = (doc) => W.bookingChanges(doc).map((e) => e.type);

/** Runs fn with NODE_ENV set, then puts it back exactly as it was. */
async function withEnv(value, fn) {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
  }
}

test('a new booking is booking.created', () => {
  const b = new Booking({ user: oid(), court: oid(), courtName: 'Court 1', date: NOV_20, startTime: '08:00', endTime: '09:00', referenceNumber: 'MKI-NEW', totalFee: 400 });
  assert.deepEqual(types(b), ['booking.created']);
});

test('status changes become approved, not approved, cancelled and completed events', () => {
  for (const [to, type] of [['confirmed', 'booking.approved'], ['rejected', 'booking.rejected'], ['cancelled', 'booking.cancelled']]) {
    const b = loaded();
    b.status = to;
    const [e, extra] = W.bookingChanges(b);
    assert.equal(e.type, type);
    assert.equal(extra, undefined);
    assert.deepEqual(e.verify.from, { status: 'pending' });
    assert.deepEqual(e.verify.to, { status: to });
  }
  const done = loaded({ status: 'confirmed' });
  done.status = 'completed';
  assert.deepEqual(types(done), ['booking.completed']);
});

test('a reschedule is one booking.rescheduled event, also when it sends the booking back to pending', () => {
  const b = loaded({ status: 'confirmed' });
  b.date = new Date('2026-11-20T16:00:00.000Z');
  b.startTime = '10:00';
  b.endTime = '11:00';
  b.status = 'pending';
  const events = W.bookingChanges(b);
  assert.deepEqual(events.map((e) => e.type), ['booking.rescheduled']);
  const changes = W.changesView(events[0].verify);
  assert.deepEqual(changes.date, { from: '2026-11-20', to: '2026-11-21' });
  assert.deepEqual(changes.startTime, { from: '08:00', to: '10:00' });
  assert.deepEqual(changes.status, { from: 'confirmed', to: 'pending' });
});

test('one save can cause several events: cancelled and refunded', () => {
  const b = loaded({ status: 'confirmed', paymentStatus: 'paid' });
  b.status = 'cancelled';
  b.paymentStatus = 'refunded';
  assert.deepEqual(types(b), ['booking.cancelled', 'booking.refunded']);
});

test('payments and check-ins', () => {
  const paid = loaded();
  paid.paymentStatus = 'paid';
  assert.deepEqual(types(paid), ['booking.paid']);
  const arrived = loaded({ status: 'confirmed' });
  arrived.checkedInAt = new Date();
  assert.deepEqual(types(arrived), ['booking.checked_in']);
  const failed = loaded();
  failed.paymentStatus = 'failed';
  assert.deepEqual(types(failed), [], 'a rejected payment proof is not an event');
});

test('setting a field to the value it already has is not an event', () => {
  const b = loaded({ status: 'confirmed' });
  b.status = 'confirmed';
  b.court = new mongoose.Types.ObjectId(String(b.court)); // same court, new object
  b.startTime = '08:00';
  b.date = new Date(NOV_20.getTime());
  assert.deepEqual(types(b), []);
});

test('a change that was undone is spotted, a later change is not mistaken for one', () => {
  const b = loaded({ status: 'cancelled' });
  b.status = 'confirmed';
  const [e] = W.bookingChanges(b);
  assert.equal(e.type, 'booking.approved');
  const undone = loaded({ _id: b._id, status: 'cancelled' }); // the rollback put the old status back
  assert.equal(W.reverted(e.verify, W.valuesOf(undone)), true);
  const stands = loaded({ _id: b._id, status: 'confirmed' });
  assert.equal(W.reverted(e.verify, W.valuesOf(stands)), false);
  const movedOn = loaded({ _id: b._id, status: 'completed' });
  assert.equal(W.reverted(e.verify, W.valuesOf(movedOn)), false);
});

test('changes made without a save are marked final (they cannot be undone)', () => {
  const c = W.committedChange({ status: ['confirmed', 'completed'] });
  assert.equal(c.final, true);
  assert.deepEqual(W.changesView(c), { status: { from: 'confirmed', to: 'completed' } });
});

test('the event body: Manila date and times, the customer name, contact details only when chosen', () => {
  const b = loaded({ status: 'confirmed', discount: 50, promoCode: 'SUMMER' });
  const user = { _id: oid(), firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@example.com', phone: '09171234567' };
  const data = W.bookingData(b, user, false);
  assert.equal(data.reference, 'MKI-TEST-1');
  assert.equal(data.date, '2026-11-20');
  assert.equal(data.start, '2026-11-20T08:00:00+08:00');
  assert.equal(data.end, '2026-11-20T09:00:00+08:00');
  assert.equal(data.court.id, String(b.court));
  assert.equal(data.currency, 'PHP');
  assert.equal(data.customer.name, 'Juan Dela Cruz');
  assert.equal('email' in data.customer, false);
  assert.equal('phone' in data.customer, false);
  const withContact = W.bookingData(b, user, true);
  assert.equal(withContact.customer.email, 'juan@example.com');
  assert.equal(withContact.customer.phone, '09171234567');
});

test('addresses: full https address, no user name or password in it, https on the live server', async () => {
  assert.equal(W.addressProblem('https://example.com/hook'), '');
  assert.equal(W.addressProblem('http://localhost:4000/hook'), ''); // fine while developing
  assert.match(W.addressProblem(''), /Enter the address/);
  assert.match(W.addressProblem('ftp://example.com/'), /https/);
  assert.match(W.addressProblem('https://user:pass@example.com/'), /password/);
  assert.match(W.addressProblem('example.com/hook'), /full address/);
  await withEnv('production', () => assert.match(W.addressProblem('http://example.com/hook'), /https/));
});

test('the live server never calls its own machine or a private network', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.10', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '::1', '::', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip']) {
    assert.equal(W.isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(W.isPrivateAddress(ip), false, ip);
  await withEnv('production', async () => {
    await assert.rejects(W.checkAddress('https://127.0.0.1/hook'), /private network/);
    await assert.rejects(W.checkAddress('https://[::1]/hook'), /private network/);
    await assert.rejects(W.checkAddress('https://169.254.169.254/latest/meta-data'), /private network/);
  });
});

test('the signing secret is stored sealed and opens only with the same JWT_SECRET', () => {
  const sealed = seal('whsec_abc123');
  assert.equal(sealed.includes('whsec_abc123'), false);
  assert.equal(open(sealed), 'whsec_abc123');
  assert.notEqual(seal('whsec_abc123'), sealed, 'a fresh IV every time');
  const before = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'a-different-secret';
  try { assert.equal(open(sealed), ''); } finally { process.env.JWT_SECRET = before; }
  assert.equal(open('garbage'), '');
  assert.equal(open(''), '');
});

test('a delivery is POSTed as signed JSON; failures and redirects are reported, never followed', async () => {
  const got = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      got.push({ url: req.url, headers: req.headers, raw });
      if (req.url === '/fail') { res.writeHead(500); return res.end('database is down'); }
      if (req.url === '/move') { res.writeHead(302, { Location: 'https://example.com/elsewhere' }); return res.end(); }
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_1', type: 'booking.approved', data: { booking: { reference: 'MKI-1' } } });
  const d = { eventId: 'evt_1', type: 'booking.approved', body };
  try {
    const ok = await W.post(`${base}/hook`, secret, d);
    assert.equal(ok.ok, true);
    assert.equal(ok.status, 200);
    assert.equal(ok.body, 'ok');
    const { headers, raw } = got[0];
    assert.equal(raw, body, 'the exact bytes that were signed');
    assert.equal(headers['content-type'], 'application/json');
    assert.equal(headers['x-webhook-id'], 'evt_1');
    assert.equal(headers['x-webhook-event'], 'booking.approved');
    assert.ok(Math.abs(Date.now() / 1000 - Number(headers['x-webhook-timestamp'])) < 60);
    // what a receiver does to check the request
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${headers['x-webhook-timestamp']}.${raw}`).digest('hex')}`;
    assert.equal(headers['x-webhook-signature'], expected);

    const failed = await W.post(`${base}/fail`, secret, d);
    assert.equal(failed.ok, false);
    assert.equal(failed.status, 500);
    assert.match(failed.error, /500/);
    assert.equal(failed.body, 'database is down');

    const moved = await W.post(`${base}/move`, secret, d);
    assert.equal(moved.ok, false);
    assert.equal(moved.status, 302);
    assert.match(moved.error, /Redirected to https:\/\/example\.com\/elsewhere/);
    assert.equal(got.length, 3, 'the redirect was not followed');
  } finally {
    server.closeAllConnections();
    server.close();
  }

  // a port with nothing listening on it
  const spare = net.createServer();
  await new Promise((r) => spare.listen(0, '127.0.0.1', r));
  const port = spare.address().port;
  await new Promise((r) => spare.close(r));
  const refused = await W.post(`http://127.0.0.1:${port}/hook`, secret, d);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /nothing is listening/);
});

test('without a database, saving a booking queues nothing and never throws', async () => {
  // the post('save') hook runs queueBookingEvents; with no connection it must return quietly
  const b = loaded({ status: 'pending' });
  b.status = 'confirmed';
  await assert.doesNotReject(W.queueBookingEvents(b, W.bookingChanges(b)));
  await assert.doesNotReject(W.queueChangeById(oid(), 'booking.completed', { status: ['confirmed', 'completed'] }));
});
