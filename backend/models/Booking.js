const mongoose = require('mongoose');
const { timestampConcurrency } = require('../utils/concurrency');

const ACTIVE = ['pending', 'confirmed', 'completed']; // statuses that occupy a slot

/**
 * Booking schema - customer flow UF-116..UF-122, admin flow AF-115..AF-120.
 * status: pending (awaiting approval) | confirmed | completed | cancelled | rejected
 */
const BookingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    court: { type: mongoose.Schema.Types.ObjectId, ref: 'Court', required: true },
    courtName: { type: String, required: true },
    date: { type: Date, required: true }, // midnight Asia/Manila (UTC+8)
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    referenceNumber: { type: String, required: true, unique: true },
    totalFee: { type: Number, required: true, min: 0 },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    paymentMethod: { type: String, trim: true, default: '' }, // cash, GCash, ...
    paidAt: { type: Date },
    // AF-121 payment verification: customer submits proof, staff verifies
    paymentReference: { type: String, trim: true, default: '' }, // GCash/bank reference the customer entered
    paymentSubmittedAt: { type: Date },
    paymentNote: { type: String, trim: true, default: '' },       // why a payment was rejected
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    // AF-122 refunds
    refund: {
      amount: { type: Number, min: 0 },
      reason: { type: String, trim: true, default: '' },
      method: { type: String, trim: true, default: '' },
      at: { type: Date },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    // AF-127 promo applied at booking time
    promoCode: { type: String, default: '' },
    discount: { type: Number, default: 0, min: 0 },
    // AF-130 staff check-in / check-out and UF-136 customer check-in
    checkedInAt: { type: Date },
    checkedOutAt: { type: Date },
    // UF-129: set when the 2-hours-before reminder went out; cleared when the booking moves
    reminderSentAt: { type: Date },
    // Google Calendar event mirroring this booking (set while it is confirmed/completed)
    calendarEventId: { type: String },
    // HitPay payment link (payment request) for the customer: GCash, QR Ph, cards, GrabPay, ShopeePay...
    hitpay: {
      requestId: { type: String },
      checkoutUrl: { type: String },
      reference: { type: String },
      amount: { type: Number },
      createdAt: { type: Date },
      checkedAt: { type: Date },            // last time the customer's page asked HitPay (rate limit)
      shortNotified: { type: Boolean },     // staff already told the link paid less than the fee
      previousRequestIds: [{ type: String }], // replaced links, still matched by the webhook
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'],
<<<<<<< HEAD:backend/models/Booking.js
      default: 'pending', // every booking waits for staff approval
=======
      default: 'pending',
>>>>>>> a7268bdf5982b171a935f488c3beb16a426aba2c:models/Booking.js
    },
    statusReason: { type: String, trim: true, default: '' }, // AF-117 cancellation / rejection reason
    statusChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    statusChangedAt: { type: Date },
    slotActive: { type: Boolean, default: true }, // derived; backs the unique slot 
           reminderSentAt: { type: Date },               // 2-hour reminder already sent
  },
  { timestamps: true }
);

   BookingSchema.pre('validate', function (next) {
     this.slotActive = ACTIVE.includes(this.status);
     // moved to a new date/time -> the new time gets its own reminder
     if (!this.isNew && (this.isModified('date') || this.isModified('startTime'))) this.reminderSentAt = undefined;
     next();
   });

// Keep Google Calendar in step with every change to when/where/whether a booking happens.
const CALENDAR_FIELDS = ['status', 'date', 'startTime', 'endTime', 'court', 'courtName'];
BookingSchema.pre('save', function (next) {
  this.$locals.calendarSync = this.isNew || CALENDAR_FIELDS.some((f) => this.isModified(f));
  next();
});
BookingSchema.post('save', function (doc) {
  if (!doc.$locals.calendarSync) return;
  const { syncBookingToCalendar } = require('../utils/integrations/google');
  setImmediate(() => syncBookingToCalendar(doc._id)); // never slows down or breaks the request
});

// One active booking per court + date + start time (race-condition proof).
// Equality-only partial filter, so it works on every MongoDB version.
BookingSchema.index(
  { court: 1, date: 1, startTime: 1 },
  { unique: true, partialFilterExpression: { slotActive: true }, name: 'unique_active_slot' }
);
BookingSchema.index({ user: 1, date: -1 });

// Timestamp concurrency control: adds writeTS (W-TS) and makes every write validate it.
BookingSchema.plugin(timestampConcurrency);

module.exports = mongoose.model('Booking', BookingSchema);
