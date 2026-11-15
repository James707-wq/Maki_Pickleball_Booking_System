/**
 * PayMongo payment links (GCash, Maya, cards). Staff create a link for a booking, the customer pays on
 * PayMongo's checkout page, and the booking is marked paid by the webhook or by "Check payment".
 * Docs: https://developers.paymongo.com/reference/links-resource
 */
const crypto = require('crypto');
const { env, configured } = require('./index');

const API = 'https://api.paymongo.com/v1';
const MIN_AMOUNT = 100; // PayMongo's minimum is PHP 100.00

async function pm(path, { method = 'GET', body } = {}) {
  if (!configured.paymongo()) throw Object.assign(new Error('PayMongo is not set up'), { status: 400 });
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(env('PAYMONGO_SECRET_KEY') + ':').toString('base64'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) {
      throw Object.assign(new Error('PayMongo rejected the API key. Check PAYMONGO_SECRET_KEY in backend/.env.'), { status: 502 });
    }
    const msg = data.errors && data.errors[0] ? data.errors[0].detail : `PayMongo error ${r.status}`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return data.data;
}

async function createLink(booking) {
  if (booking.totalFee < MIN_AMOUNT) {
    throw Object.assign(new Error(`PayMongo needs at least ₱${MIN_AMOUNT}. Collect this one at the facility.`), { status: 400 });
  }
  const link = await pm('/links', {
    method: 'POST',
    body: { data: { attributes: {
      amount: Math.round(booking.totalFee * 100), // centavos
      description: `${booking.courtName} booking ${booking.referenceNumber}`,
      remarks: booking.referenceNumber,
    } } },
  });
  return { linkId: link.id, checkoutUrl: link.attributes.checkout_url, reference: link.attributes.reference_number };
}

const METHOD = { gcash: 'GCash', paymaya: 'Maya', card: 'Card', grab_pay: 'GrabPay', dob: 'Online banking', qrph: 'QR Ph' };

/** Closes an unpaid link so it can't be paid any more. Returns 'archived', 'paid' or 'gone'. */
async function archiveLink(linkId) {
  const { paid } = await getLinkPayment(linkId);
  if (paid) return 'paid';
  try {
    await pm(`/links/${encodeURIComponent(linkId)}/archive`, { method: 'POST' });
    return 'archived';
  } catch (err) {
    console.error(`Could not archive PayMongo link ${linkId}:`, err.message);
    return 'gone';
  }
}

/** Returns { paid, amount (pesos), method } for a link. */
async function getLinkPayment(linkId) {
  const link = await pm(`/links/${encodeURIComponent(linkId)}`);
  const paid = link.attributes.status === 'paid';
  const amount = Number(link.attributes.amount || 0) / 100;
  const payment = (link.attributes.payments || [])[0];
  const attrs = payment ? (payment.data ? payment.data.attributes : payment.attributes) : null;
  const type = attrs && attrs.source ? attrs.source.type : '';
  return { paid, amount, method: `${METHOD[type] || 'Online'} via PayMongo` };
}

/**
 * Checks the Paymongo-Signature header: "t=<time>,te=<test sig>,li=<live sig>",
 * where each sig is HMAC-SHA256 of "<t>.<raw body>" with the webhook secret.
 */
function verifyWebhook(rawBody, header) {
  const secret = env('PAYMONGO_WEBHOOK_SECRET');
  if (!secret || !rawBody || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  if (!parts.t) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 5 * 60) return false; // reject old replays
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const given = env('PAYMONGO_SECRET_KEY').startsWith('sk_live') ? parts.li : parts.te;
  if (!given || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

module.exports = { createLink, getLinkPayment, archiveLink, verifyWebhook, MIN_AMOUNT };

/**
 * If the booking's PayMongo link has been paid, marks the booking paid (once), logs the
 * transaction and tells the customer. Returns { paid, alreadyPaid, booking }.
 */
async function settleBooking(booking, { by } = {}) {
  const Booking = require('../../models/Booking');
  const U = require('../bookingUtils');
  const { logTransaction } = require('../transactions');
  if (!booking.paymongo || !booking.paymongo.linkId) {
    throw Object.assign(new Error('No PayMongo link was created for this booking'), { status: 400 });
  }
  if (booking.paymentStatus === 'paid') return { paid: true, alreadyPaid: true, booking };
  if (!['pending', 'failed'].includes(booking.paymentStatus)) {
    return { paid: false, booking, message: `This booking's payment is ${booking.paymentStatus}` };
  }

  const { paid, amount, method } = await getLinkPayment(booking.paymongo.linkId);
  if (!paid) return { paid: false, booking };

  // the link must cover the current fee (it may have changed after the link was sent)
  if (Math.round(amount * 100) < Math.round(booking.totalFee * 100)) {
    const msg = `PayMongo payment of ₱${amount} for booking ${booking.referenceNumber} is less than its fee of ₱${booking.totalFee}. Collect the difference and record it by hand.`;
    if (!booking.paymongo.shortNotified) {
      await Booking.updateOne({ _id: booking._id }, { $set: { 'paymongo.shortNotified': true } });
      await U.notifyStaff(msg);
    }
    return { paid: false, booking, message: msg };
  }

  // only one caller (webhook or staff button) may flip it to paid
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, paymentStatus: { $in: ['pending', 'failed'] } },
    { $set: { paymentStatus: 'paid', paymentMethod: method, paidAt: new Date(), paymentReference: booking.paymongo.reference || booking.paymongo.linkId, paymentNote: '', verifiedAt: new Date(), ...(by ? { verifiedBy: by } : {}) } },
    { new: true }
  );
  if (!updated) return { paid: true, alreadyPaid: true, booking: await Booking.findById(booking._id) };
  await logTransaction(updated, 'payment', { amount, method, note: `PayMongo link ${booking.paymongo.linkId}`, by });
  await U.notify(updated.user, `Payment for booking ${updated.referenceNumber} was received via PayMongo. Thank you!`,
    { subject: `Payment received for ${updated.referenceNumber}`, booking: updated });
  return { paid: true, booking: updated };
}

module.exports.settleBooking = settleBooking;

/**
 * Returns a payable link for the booking: reuses the current one if it matches the fee, otherwise
 * closes the old link and creates a new one. Throws { status } errors with a plain message.
 */
async function ensureLink(booking, { by, renew = false } = {}) {
  if (['cancelled', 'rejected'].includes(booking.status)) {
    throw Object.assign(new Error('This booking is cancelled or rejected'), { status: 400 });
  }
  if (!['pending', 'failed'].includes(booking.paymentStatus)) {
    throw Object.assign(new Error(`This booking's payment is already ${booking.paymentStatus}`), { status: 400 });
  }
  const old = booking.paymongo && booking.paymongo.linkId ? booking.paymongo : null;
  if (old && old.amount === booking.totalFee && !renew) return { paymongo: old, created: false };
  if (old) {
    // close the old link first so nobody pays the wrong amount on it
    const closed = await archiveLink(old.linkId);
    if (closed === 'paid') {
      const r = await settleBooking(booking, { by });
      throw Object.assign(new Error(r.paid ? 'The previous payment link was already paid. Payment recorded.' : (r.message || 'The previous link was already paid.')), { status: 409 });
    }
  }
  const link = await createLink(booking);
  booking.paymongo = {
    ...link, amount: booking.totalFee, createdAt: new Date(),
    previousLinkIds: old ? [...(old.previousLinkIds || []), old.linkId].slice(-10) : [],
  };
  await booking.save();
  return { paymongo: booking.paymongo, created: true };
}
module.exports.ensureLink = ensureLink;
