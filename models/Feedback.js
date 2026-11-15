const mongoose = require('mongoose');
const { timestampConcurrency } = require('../utils/concurrency');

/** AF-128 Feedback Management (customers leave it as UF-133). One review per booking. */
const FeedbackSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    court: { type: mongoose.Schema.Types.ObjectId, ref: 'Court' },
    courtName: { type: String, default: '' },
    rating: { type: Number, required: [true, 'Rating is required'], min: [1, 'Rating must be 1 to 5'], max: [5, 'Rating must be 1 to 5'] },
    comment: { type: String, trim: true, default: '', maxlength: 1000 },
    status: { type: String, enum: ['new', 'reviewed', 'hidden'], default: 'new' },
  },
  { timestamps: true }
);

// Timestamp concurrency control: adds writeTS (W-TS) and makes every write validate it.
FeedbackSchema.plugin(timestampConcurrency);

module.exports = mongoose.model('Feedback', FeedbackSchema);
