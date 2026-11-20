const mongoose = require('mongoose');
const { timestampConcurrency } = require('../utils/concurrency');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * User schema
 * Customers: UF-101..107. Staff/admin accounts: AF-101..107 (see `role`).
 */
const UserSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: [true, 'First name is required'], trim: true },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    phone: { type: String, trim: true, default: '' },
    // booking updates by email (only when the facility has email switched on)
    notifyEmail: { type: Boolean, default: true },
    // customizable profile avatar - option keys only (see frontend/js/avatar.js), validated in backend/routes/userRoutes.js
    avatar: {
      type: new mongoose.Schema({
        skin: String, hair: String, hairColor: String, eyes: String, brows: String, mouth: String,
        facial: String, hat: String, glasses: String, shirt: String, bg: String,
      }, { _id: false }),
      default: undefined,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: { type: String, enum: ['user', 'staff', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true }, // AF-105/106 deactivate accounts
    passwordChangedAt: { type: Date },
        // login security (utils/loginSecurity.js)
    failedLoginCount: { type: Number, default: 0 }, // wrong passwords in a row
    lockUntil: { type: Date },                       // sign-in refused until this time
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String, default: '' },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpire: { type: Date, select: false },
    // security PIN for sensitive admin changes (turning integrations on/off), hashed like the password.
    // See utils/twoStep.js. securityPinSetAt doubles as "has a PIN" without loading the hash.
    securityPin: { type: String, select: false },
    securityPinSetAt: { type: Date },
    pinFailedAttempts: { type: Number, select: false }, // wrong PINs/passwords in a row
    pinLockedUntil: { type: Date, select: false },
  },
  { timestamps: true }
);

// AF-141: a new password or a deactivated account ends the person's sessions (their tokens stop working).
// The token check refuses them anyway (passwordChangedAt, isActive); this keeps the session list true.
UserSchema.pre('save', function (next) {
  if (this.isNew) { this.$locals.endSessions = ''; return next(); }
  if (this.isModified('password')) this.$locals.endSessions = 'Password changed';
  else if (this.isModified('isActive') && this.isActive === false) this.$locals.endSessions = 'Account deactivated';
  else this.$locals.endSessions = '';
  this.$locals.endSessionsBefore = new Date(); // sessions started after the save (a new sign-in) stay open
  next();
});
UserSchema.post('save', function (doc) {
  const reason = doc.$locals.endSessions;
  if (!reason) return;
  doc.$locals.endSessions = '';
  require('../utils/sessions').endAllFor(doc._id, { reason, before: doc.$locals.endSessionsBefore })
    .catch((err) => console.error('Ending sessions failed:', err.message));
});

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000); // invalidates older JWTs
  next();
});

UserSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

UserSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000;
  return resetToken;
};

// Timestamp concurrency control: adds writeTS (W-TS) and makes every write validate it.
// lockout bookkeeping doesn't count as a change to the account (an admin's open form stays valid)
UserSchema.plugin(timestampConcurrency, { ignore: ['failedLoginCount', 'lockUntil', 'lastLoginAt', 'lastLoginIp'] });

module.exports = mongoose.model('User', UserSchema);
