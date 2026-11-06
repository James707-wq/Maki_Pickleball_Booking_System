const mongoose = require('mongoose');

/** AF-126 Announcements Management (shown to customers as UF-130). */
const AnnouncementSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 120 },
    body: { type: String, required: [true, 'Message is required'], trim: true, maxlength: 2000 },
    published: { type: Boolean, default: false },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Announcement', AnnouncementSchema);
