/**
 * QR check-in codes. A code is "MKI1.<bookingId>.<signature>", signed with the server secret,
 * so a code can't be guessed or made up from a booking reference.
 */
const crypto = require('crypto');

const sign = (id) => crypto.createHmac('sha256', String(process.env.JWT_SECRET || ''))
  .update(`checkin:${id}`).digest('base64url').slice(0, 22);

const makeCheckinCode = (bookingId) => `MKI1.${bookingId}.${sign(String(bookingId))}`;

/** Returns the booking id inside a valid code, or null. */
function readCheckinCode(code) {
  const m = /^MKI1\.([a-f0-9]{24})\.([A-Za-z0-9_-]{22})$/.exec(String(code || '').trim());
  if (!m) return null;
  const expected = sign(m[1]);
  if (!crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected))) return null;
  return m[1];
}

module.exports = { makeCheckinCode, readCheckinCode };
