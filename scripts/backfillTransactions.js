/**
 * One-time (safe to re-run): creates Transaction History rows (AF-123) for bookings that were
 * marked paid / refunded BEFORE the transaction log existed, so revenue analytics (AF-133) include them.
 *   node scripts/backfillTransactions.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Transaction = require('../models/Transaction');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const bookings = await Booking.find({ paymentStatus: { $in: ['paid', 'refunded'] } });
  let added = 0;
  for (const b of bookings) {
    const base = { booking: b._id, user: b.user, referenceNumber: b.referenceNumber, courtName: b.courtName, method: b.paymentMethod || '' };
    if (!(await Transaction.exists({ booking: b._id, type: 'payment' }))) {
      await Transaction.create({ ...base, type: 'payment', amount: b.totalFee, note: 'Imported', createdAt: b.paidAt || b.updatedAt });
      added += 1;
    }
    if (b.paymentStatus === 'refunded' && !(await Transaction.exists({ booking: b._id, type: 'refund' }))) {
      await Transaction.create({ ...base, type: 'refund', amount: (b.refund && b.refund.amount) || b.totalFee, note: 'Imported', createdAt: (b.refund && b.refund.at) || b.updatedAt });
      added += 1;
    }
  }
  console.log(`Added ${added} transaction row(s) for ${bookings.length} paid/refunded booking(s).`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
