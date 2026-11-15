const mongoose = require('mongoose');

/**
 * One-time codes for the two-step check on sensitive admin changes (see utils/twoStep.js).
 * Only a keyed hash of the code is stored. The change waiting for the code is saved here too, so the
 * code approves exactly the change the admin was shown, not whatever is sent along with it later.
 */
const SecurityCodeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, required: true },                   // 'integrations'
    what: { type: String, default: '' },                          // e.g. "Turn off HitPay"
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },  // e.g. { switches: { hitpay: false } }
    codeHash: { type: String, required: true },
    sentTo: { type: [String], default: [] },                      // masked, e.g. "j****@gmail.com"
    attempts: { type: Number, default: 0 },                       // wrong codes for the current code
    sends: { type: Number, default: 1 },                          // first code + resends
    lastSentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
SecurityCodeSchema.index({ user: 1, purpose: 1, createdAt: -1 });
// MongoDB deletes codes a day after they were made (kept that long so the "codes per 15 minutes" limit can count them)
SecurityCodeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model('SecurityCode', SecurityCodeSchema);
