const mongoose = require('mongoose');

/**
 * Login history - one row for every sign-in attempt on the customer site or the admin console.
 * reason: ok | wrong_password | unknown_email | deactivated | locked | locked_now | no_admin_access
 */
const LoginAttemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: { type: String, default: '' },
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    portal: { type: String, enum: ['customer', 'admin'], required: true },
    success: { type: Boolean, required: true },
    reason: {
      type: String,
      enum: ['ok', 'wrong_password', 'unknown_email', 'deactivated', 'locked', 'locked_now', 'no_admin_access'],
      required: true,
    },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

LoginAttemptSchema.index({ createdAt: -1 });
LoginAttemptSchema.index({ email: 1, createdAt: -1 });
// delete history older than 180 days automatically
LoginAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60, name: 'login_history_ttl' });

module.exports = mongoose.model('LoginAttempt', LoginAttemptSchema);