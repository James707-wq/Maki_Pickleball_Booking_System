const mongoose = require('mongoose');
const { timestampConcurrency } = require('../utils/concurrency');

/**
 * SF-134 Shift Information: when a staff member works. Admins assign shifts (People -> Shifts); staff see their own
 * (My shifts, and on the dashboard). The payment report for a shift (SF-132) uses it as its time window.
 */
const ShiftSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, default: '' },
    date: { type: Date, required: true }, // midnight Asia/Manila
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/ },
    note: { type: String, trim: true, maxlength: 100, default: '' }, // e.g. "Front desk", "Opening"
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
ShiftSchema.index({ date: 1, user: 1 });
ShiftSchema.index({ user: 1, date: 1 });

// Timestamp concurrency control: adds writeTS (W-TS) and makes every write validate it.
ShiftSchema.plugin(timestampConcurrency);

module.exports = mongoose.model('Shift', ShiftSchema);
