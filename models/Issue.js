const mongoose = require('mongoose');

/** AF-129 Complaint/Issue Management (customers report problems as UF-134 / UF-132). */
const ReplySchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byRole: { type: String, enum: ['user', 'staff', 'admin'], default: 'user' },
    byName: { type: String, default: '' },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const IssueSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    category: { type: String, enum: ['court', 'booking', 'payment', 'system', 'other'], default: 'other' },
    subject: { type: String, required: [true, 'Subject is required'], trim: true, maxlength: 120 },
    message: { type: String, required: [true, 'Please describe the problem'], trim: true, maxlength: 2000 },
    status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
    replies: [ReplySchema],
  },
  { timestamps: true }
);
IssueSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('Issue', IssueSchema);
