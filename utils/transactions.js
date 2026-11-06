const Transaction = require('../models/Transaction');

/** AF-123: record a money movement. Never lets a logging failure break the payment itself. */
async function logTransaction(booking, type, { amount, method, note, by } = {}) {
  try {
    await Transaction.create({
      booking: booking._id,
      user: booking.user && booking.user._id ? booking.user._id : booking.user,
      referenceNumber: booking.referenceNumber,
      courtName: booking.courtName,
      type,
      amount: amount ?? booking.totalFee,
      method: method || booking.paymentMethod || '',
      note: note || '',
      recordedBy: by,
    });
  } catch (err) {
    console.error('Transaction log failed:', err.message);
  }
}

module.exports = { logTransaction };
