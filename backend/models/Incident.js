const mongoose = require('mongoose');
const { timestampConcurrency } = require('../utils/concurrency');

/**
 * SF-130 Incident Reporting: something that happened during a customer's session (an injury, an argument, damage, a
 * rule broken, a no-show, a lost item...), recorded by staff. Admins review it and mark it resolved.
 */
const CATEGORIES = ['injury', 'dispute', 'damage', 'rules', 'no_show', 'lost_item', 'safety', 'other'];

const UpdateSchema = new mongoose.Schema(
  {
    byName: { type: String, default: '' },
    byRole: { type: String, default: '' },
    message: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: ['open', 'resolved', ''], default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const IncidentSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    referenceNumber: { type: String, default: '' },
    customerName: { type: String, trim: true, maxlength: 120, default: '' },
    court: { type: mongoose.Schema.Types.ObjectId, ref: 'Court' },
    courtName: { type: String, default: '' },
    occurredAt: { type: Date, default: Date.now },
    category: { type: String, enum: CATEGORIES, required: true },
    severity: { type: String, enum: ['minor', 'serious'], default: 'minor' },
    title: { type: String, required: [true, 'Say what happened'], trim: true, maxlength: 100 },
    details: { type: String, trim: true, maxlength: 2000, default: '' },
    actionTaken: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedByName: { type: String, default: '' },
    updates: [UpdateSchema],
    resolvedAt: { type: Date },
    resolvedByName: { type: String, default: '' },
  },
  { timestamps: true }
);
IncidentSchema.index({ status: 1, occurredAt: -1 });
IncidentSchema.index({ booking: 1 });

// Timestamp concurrency control: adds writeTS (W-TS) and makes every write validate it.
IncidentSchema.plugin(timestampConcurrency);

module.exports = mongoose.model('Incident', IncidentSchema);
module.exports.CATEGORIES = CATEGORIES;
