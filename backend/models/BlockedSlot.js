const mongoose = require('mongoose');

/** A slot an admin has closed off (maintenance, tournament, private event) - AF-113/AF-114. */
const BlockedSlotSchema = new mongoose.Schema(
  {
    court: { type: mongoose.Schema.Types.ObjectId, ref: 'Court', required: true },
    date: { type: Date, required: true }, // midnight Asia/Manila
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    reason: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

BlockedSlotSchema.index({ court: 1, date: 1, startTime: 1 }, { unique: true });

module.exports = mongoose.model('BlockedSlot', BlockedSlotSchema);
