/**
 * HitPay payment links: GCash, QR Ph, cards, GrabPay, ShopeePay and whatever else the HitPay account has
 * switched on. Staff send a link from a booking, or the customer presses "Pay online now"; the customer pays
 * on HitPay's checkout page and is sent back to their booking. The booking is marked paid by the webhook,
 * when the customer comes back, or when staff press "Check payment". Every one of those asks HitPay for the
 * real status first, so nothing in a browser or webhook body is trusted on its own.
 * Docs: https://docs.hitpayapp.com/apis/guide/online-payments
 */
const crypto = require('crypto');
const { env, configured, hitpaySandbox } = require('./index');

const MIN_AMOUNT = 0.3; // HitPay's smallest payment request
// HITPAY_API_URL is only for tests (a stand-in for HitPay)
const apiBase = () => env('HITPAY_API_URL') || (hitpaySandbox() ? 'https://api.sandbox.hit-pay.com/v1' : 'https://api.hit-pay.com/v1');
const fail = (message, status) => Object.assign(new Error(message), { status });

async function hp(path, { method = 'GET', form } = {}) {
  if (!configured.hitpay()) throw fail('HitPay is not set up', 400);
  const r = await fetch(apiBase() + path, {
    method,
    headers: {
      'X-BUSINESS-API-KEY': env('HITPAY_API_KEY'),
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw fail('HitPay rejected the API key. Check HITPAY_API_KEY in backend/.env, and HITPAY_SANDBOX (true for sandbox keys, false for live keys).', 502);
    }
    if (r.status === 404) throw fail('HitPay could not find that payment link. Was it made with other HitPay keys?', 502);
    const first = data.errors && Object.values(data.errors)[0]; // 422: { message, errors: { field: [text] } }
    throw fail((Array.isArray(first) ? first[0] : first) || data.message || `HitPay error ${r.status}`, 502);
  }
  return data;
}

/** Creates a payment request (checkout link) for the booking's current fee. */
async function createRequest(booking) {
  if (!(booking.totalFee >= MIN_AMOUNT)) throw fail('This fee is too small to pay online. Collect it at the facility.', 400);
  const User = require('../../models/User');
  const customer = await User.findById(booking.user).select('firstName lastName email');
  const site = env('CLIENT_URL').replace(/\/+$/, '');
  const req = await hp('/payment-requests', {
    method: 'POST',
    form: {
      amount: booking.totalFee.toFixed(2),
      currency: 'PHP',
      purpose: `${booking.courtName} booking ${booking.referenceNumber}`.slice(0, 255),
      reference_number: booking.referenceNumber,
      // after paying, HitPay sends the customer back to their booking (it adds the request id and status)
      ...(site ? { redirect_url: `${site}/booking-confirmation.html?id=${booking._id}` } : {}),
      ...(customer ? { name: `${customer.firstName} ${customer.lastName}`.trim(), email: customer.email } : {}),
    },
  });
  if (!req.id || !/^https:\/\//.test(req.url || '')) throw fail('HitPay did not send back a checkout link. Try again in a minute.', 502);
  return { requestId: req.id, checkoutUrl: req.url, reference: req.reference_number || booking.referenceNumber };
}

// payment_type -> what staff and receipts show ("GCash via HitPay")
const METHOD = {
  gcash: 'GCash', qrph_netbank: 'QR Ph', card: 'Card', card_cybersource: 'Card', grabpay_direct: 'GrabPay', grabpay: 'GrabPay',
  shopee_pay: 'ShopeePay', shopee_pay_later: 'SPayLater', billease: 'BillEase', paymaya: 'Maya', maya: 'Maya', wechat_pay: 'WeChat Pay',
  upay_online: 'UnionBank Online', upay_instapay: 'InstaPay', upay_pchc: 'PESONet', upay_bayad: 'Bayad Center', upay_ecpy: 'ECPay', upay_plwn: 'Palawan Pawnshop',
};
const PAID = ['succeeded', 'succeeded_manually'];

/** Asks HitPay about a payment request: { paid, amount (pesos), method, paymentId, status }. */
async function getRequestPayment(requestId) {
  const req = await hp(`/payment-requests/${encodeURIComponent(requestId)}`);
  const payment = (req.payments || []).find((p) => PAID.includes(p.status));
  const type = payment ? String(payment.payment_type || '') : '';
  return {
    paid: req.status === 'completed' || Boolean(payment),
    amount: Number(payment ? payment.amount : req.amount) || 0,
    method: `${METHOD[type] || 'Online'} via HitPay`,
    paymentId: payment ? String(payment.id || '') : '',
    status: req.status,
  };
}

/** Closes an unpaid payment request so it can't be paid any more. Returns 'closed', 'paid' or 'gone'. */
async function closeRequest(requestId) {
  const { paid } = await getRequestPayment(requestId); // if HitPay can't be asked, stop here rather than guess
  if (paid) return 'paid';
  try {
    await hp(`/payment-requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' });
    return 'closed';
  } catch (err) {
    console.error(`Could not close HitPay payment request ${requestId}:`, err.message);
    return 'gone'; // already expired or deleted on HitPay's side
  }
}

/**
 * Checks the Hitpay-Signature header of a webhook event: the hex HMAC-SHA256 of the raw JSON body,
 * keyed with the salt of the webhook endpoint (HitPay dashboard -> Developers -> Webhook Endpoints).
 */
function verifyWebhook(rawBody, signature) {
  const salt = env('HITPAY_WEBHOOK_SALT');
  if (!salt || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', salt).update(rawBody).digest('hex');
  const given = String(signature).trim().toLowerCase();
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * If the booking's HitPay payment request has been paid, marks the booking paid (once), logs the
 * transaction and tells the customer. Returns { paid, alreadyPaid, booking, message }.
 */
async function settleBooking(booking, { by } = {}) {
  const Booking = require('../../models/Booking');
  const U = require('../bookingUtils');
  const { logTransaction } = require('../transactions');
  if (!booking.hitpay || !booking.hitpay.requestId) {
    throw fail('No HitPay payment link was made for this booking', 400);
  }
  if (booking.paymentStatus === 'paid') return { paid: true, alreadyPaid: true, booking };
  if (!['pending', 'failed'].includes(booking.paymentStatus)) {
    return { paid: false, booking, message: `This booking's payment is ${booking.paymentStatus}` };
  }

  const { paid, amount, method, paymentId } = await getRequestPayment(booking.hitpay.requestId);
  if (!paid) return { paid: false, booking };

  // the payment must cover the current fee (the fee can change after the link was made)
  if (Math.round(amount * 100) < Math.round(booking.totalFee * 100)) {
    const msg = `HitPay payment of ₱${amount} for booking ${booking.referenceNumber} is less than its fee of ₱${booking.totalFee}. Collect the difference and record it by hand.`;
    if (!booking.hitpay.shortNotified) {
      await Booking.updateOne({ _id: booking._id }, { $set: { 'hitpay.shortNotified': true } });
      await U.notifyStaff(msg);
    }
    return { paid: false, booking, message: msg };
  }

  // only one caller (webhook, customer coming back, or staff button) may flip it to paid
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, paymentStatus: { $in: ['pending', 'failed'] } },
    { $set: { paymentStatus: 'paid', paymentMethod: method, paidAt: new Date(), paymentReference: paymentId || booking.hitpay.requestId, paymentNote: '', verifiedAt: new Date(), ...(by ? { verifiedBy: by } : {}) } },
    { new: true }
  );
  if (!updated) return { paid: true, alreadyPaid: true, booking: await Booking.findById(booking._id) };
  await logTransaction(updated, 'payment', { amount, method, note: `HitPay payment request ${booking.hitpay.requestId}`, by });
  await U.notify(updated.user, `Payment for booking ${updated.referenceNumber} was received via HitPay. Thank you!`,
    { subject: `Payment received for ${updated.referenceNumber}`, booking: updated });
  return { paid: true, booking: updated };
}

/**
 * Returns a payable link for the booking: reuses the current one if it matches the fee, otherwise closes
 * the old one and makes a new one. Throws { status } errors with a plain message.
 */
async function ensurePaymentLink(booking, { by, renew = false } = {}) {
  if (['cancelled', 'rejected'].includes(booking.status)) throw fail('This booking is cancelled or rejected', 400);
  if (!['pending', 'failed'].includes(booking.paymentStatus)) throw fail(`This booking's payment is already ${booking.paymentStatus}`, 400);

  const old = booking.hitpay && booking.hitpay.requestId ? booking.hitpay : null;
  if (old && old.amount === booking.totalFee && !renew) return { hitpay: old, created: false };
  if (old) {
    // close the old link first so nobody pays the wrong amount on it
    const closed = await closeRequest(old.requestId);
    if (closed === 'paid') {
      const r = await settleBooking(booking, { by });
      throw fail(r.paid ? 'The previous payment link was already paid. Payment recorded.' : (r.message || 'The previous link was already paid.'), 409);
    }
  }
  const link = await createRequest(booking);
  booking.hitpay = {
    ...link, amount: booking.totalFee, createdAt: new Date(),
    previousRequestIds: old ? [...(old.previousRequestIds || []), old.requestId].slice(-10) : [],
  };
  await booking.save();
  return { hitpay: booking.hitpay, created: true };
}

module.exports = { MIN_AMOUNT, createRequest, getRequestPayment, closeRequest, verifyWebhook, settleBooking, ensurePaymentLink };
