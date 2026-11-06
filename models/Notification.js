const mongoose = require('mongoose');

/**
 * Notification schema - powers the "notifications" part of the Dashboard (UF-108).
 */
const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // AF-125: set when an admin sent it by hand
    batch: { type: String, index: true },                          // groups one broadcast into one log row
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', NotificationSchema);
