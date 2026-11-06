const mongoose = require('mongoose');

/** AF-135 Audit Logs - who did what in the admin console. Written automatically, never edited. */
const AuditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    action: { type: String, required: true },   // human sentence, e.g. "Approved a booking"
    method: { type: String, default: '' },
    path: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    statusCode: { type: Number, default: 0 },
    entityId: { type: String, default: '' },
    detail: { type: String, default: '' },      // short, safe summary of what changed (never passwords)
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
AuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
