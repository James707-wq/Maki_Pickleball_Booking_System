const mongoose = require('mongoose');
const { timestampConcurrency } = require('../utils/concurrency');

/** AF-126 Announcements Management (shown to customers as UF-130). */
const AnnouncementSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 120 },
    body: { type: String, required: [true, 'Message is required'], trim: true, maxlength: 2000 },
    published: { type: Boolean, default: false },
    // SF-128: who sees it - customers (their dashboard), staff (the console's Announcements), or everyone
    audience: { type: String, enum: ['customers', 'staff', 'everyone'], default: 'customers' },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Timestamp concurrency control: adds writeTS (W-TS) and makes every write validate it.
AnnouncementSchema.plugin(timestampConcurrency);

module.exports = mongoose.model('Announcement', AnnouncementSchema);
