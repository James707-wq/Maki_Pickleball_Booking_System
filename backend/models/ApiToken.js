const mongoose = require('mongoose');

/**
 * An API token another system uses to call /api/v1 (utils/apiTokens.js). The token itself is shown once, when it is
 * made, and never stored: only its SHA-256 hash (to recognise it) and its first characters (so admins can tell tokens
 * apart). What it may do, how fast and until when are checked before it is saved.
 */
const ApiTokenSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    prefix: { type: String, required: true },                 // "mkp_8f3kA1b2", shown in the admin console
    hash: { type: String, required: true, unique: true },     // SHA-256 of the whole token
    scopes: { type: [String], required: true },               // courts:read, bookings:read, customers:read, checkins:write
    rateLimit: {
      limit: { type: Number, required: true, min: 1 },
      window: { type: String, enum: ['minute', 'hour', 'day'], required: true },
    },
    expiresAt: { type: Date, default: null },                 // null = never expires
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
    lastUsedAt: { type: Date },
    lastUsedIp: { type: String, default: '' },
    revokedAt: { type: Date, default: null },
    revokedByName: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ApiToken', ApiTokenSchema);
