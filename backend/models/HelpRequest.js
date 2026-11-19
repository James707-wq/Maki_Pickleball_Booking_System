const mongoose = require('mongoose');
const { timestampConcurrency } = require('../utils/concurrency');

/**
 * SF-136 Help/Support: a staff member asks the administrators for help (Help & support -> Ask the administrator).
 * Admins answer in the same thread (People -> Help requests); the asker is told.
 */
const TOPICS = ['how_to', 'problem', 'account', 'schedule', 'other'];

const ReplySchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    byRole: { type: String, default: '' },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const HelpRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, default: '' },
    userRole: { type: String, default: '' },
    topic: { type: String, enum: TOPICS, default: 'other' },
    subject: { type: String, required: [true, 'Write a subject'], trim: true, maxlength: 120 },
    message: { type: String, required: [true, 'Write what you need help with'], trim: true, maxlength: 2000 },
    urgent: { type: Boolean, default: false },
    status: { type: String, enum: ['open', 'answered', 'closed'], default: 'open' },
    replies: [ReplySchema],
  },
  { timestamps: true }
);
HelpRequestSchema.index({ status: 1, updatedAt: -1 });
HelpRequestSchema.index({ user: 1, updatedAt: -1 });

// Timestamp concurrency control: adds writeTS (W-TS) and makes every write validate it.
HelpRequestSchema.plugin(timestampConcurrency);

module.exports = mongoose.model('HelpRequest', HelpRequestSchema);
module.exports.TOPICS = TOPICS;
