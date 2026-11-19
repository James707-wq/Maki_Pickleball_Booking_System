const mongoose = require('mongoose');

/**
 * AF-141 Session management / AF-144 Logout. One record per sign-in (customer site or admin console).
 * The sign-in token carries the session's id (sid); every request checks the session is still open,
 * so ending a session (signing out, an admin ending it, a password change, a deactivated account)
 * stops its token at once instead of when it expires. See utils/sessions.js.
 */
const SessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    portal: { type: String, enum: ['customer', 'admin'], required: true },
    method: { type: String, default: 'password' }, // password | google | signup | reset
    ip: { type: String, default: '' },             // where it signed in
    userAgent: { type: String, default: '' },
    lastSeenAt: { type: Date, default: Date.now }, // updated at most every few minutes
    lastSeenIp: { type: String, default: '' },
    expiresAt: { type: Date, required: true },     // same as the token's expiry
    endedAt: { type: Date, default: null },
    endReason: { type: String, default: '' },      // "Signed out", "Ended by an admin", "Password changed"...
    endedByName: { type: String, default: '' },
    purgeAt: { type: Date, required: true },       // MongoDB deletes the record after this (30 days after it ends)
  },
  { timestamps: true }
);
SessionSchema.index({ user: 1, endedAt: 1 });
SessionSchema.index({ endedAt: 1, expiresAt: -1 });
SessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', SessionSchema);
