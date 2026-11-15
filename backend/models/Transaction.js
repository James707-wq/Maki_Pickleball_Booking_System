const mongoose = require('mongoose');

/**
 * AF-123 Transaction History - one row for every money movement on a booking.
 * type: payment (money received) | refund (money returned) | failed (payment could not be verified)
 */
const TransactionSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    referenceNumber: { type: String, required: true }, // booking reference, kept so rows survive booking edits
    courtName: { type: String, default: '' },
    type: { type: String, enum: ['payment', 'refund', 'failed'], required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
TransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
