/**
 * Login security: login history + account lockout after repeated wrong passwords.
 */
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const LoginAttempt = require('../models/LoginAttempt');

const MAX_FAILED = Math.max(parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 5, 1);
const LOCK_MINUTES = Math.max(parseInt(process.env.LOGIN_LOCK_MINUTES, 10) || 15, 1);

// used when the email doesn't exist, so a wrong email takes as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const minutesLeft = (until) => Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000));

/** Writes one login-history row. Never lets a logging failure break the sign-in. */
function recordAttempt(req, { portal, success, reason, user, email }) {
  LoginAttempt.create({
    user: user ? user._id : undefined,
    email: String((user && user.email) || email || '').toLowerCase().slice(0, 120),
    name: user ? `${user.firstName} ${user.lastName}`.trim() : '',
    role: user ? user.role : '',
    portal,
    success,
    reason,
    ip: req.ip || '',
    userAgent: String(req.get('user-agent') || '').slice(0, 300),
  }).catch((err) => console.error('Login history failed:', err.message));
}

/** Counts a wrong password (atomic $inc). Locks the account when the limit is reached. */
async function registerFailure(user) {
  const counted = await User.findOneAndUpdate(
    { _id: user._id },
    { $inc: { failedLoginCount: 1 } },
    { new: true, timestamps: false }
  );
  if (!counted || counted.failedLoginCount < MAX_FAILED) return { locked: false };
  const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
  await User.updateOne(
    { _id: user._id, failedLoginCount: { $gte: MAX_FAILED } },
    { $set: { lockUntil, failedLoginCount: 0 } },
    { timestamps: false }
  );
  return { locked: true, lockUntil };
}

/** Clears the counter and records when/where the account last signed in. */
async function registerSuccess(user, req) {
  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginCount: 0, lastLoginAt: new Date(), lastLoginIp: req.ip || '' }, $unset: { lockUntil: 1 } },
    { timestamps: false }
  );
}

/** Clears a lock (admin "Unlock" button, or a completed password reset). */
async function unlock(userId) {
  await User.updateOne({ _id: userId }, { $set: { failedLoginCount: 0 }, $unset: { lockUntil: 1 } }, { timestamps: false });
}

/** Checks email + password. Returns { user } on success, or { code, message, reason, user? } on failure. */
async function checkCredentials(email, password) {
  if (!email || !password) return { code: 400, message: 'Please provide email and password', reason: null };
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+password');

  if (!user) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    return { code: 401, message: 'Invalid email or password', reason: 'unknown_email' };
  }
  if (user.lockUntil && user.lockUntil > new Date()) {
    const m = minutesLeft(user.lockUntil);
    return {
      code: 423, user, reason: 'locked',
      message: `This account is locked after too many wrong passwords. Try again in ${m} minute${m === 1 ? '' : 's'}, or reset your password.`,
    };
  }
  if (!(await user.matchPassword(String(password)))) {
    const { locked } = await registerFailure(user);
    if (locked) {
      return {
        code: 423, user, reason: 'locked_now',
        message: `Too many wrong passwords. This account is locked for ${LOCK_MINUTES} minutes. You can reset your password to unlock it now.`,
      };
    }
    return { code: 401, user, reason: 'wrong_password', message: 'Invalid email or password' };
  }
  if (!user.isActive) {
    return { code: 401, user, reason: 'deactivated', message: 'This account has been deactivated. Please contact the facility.' };
  }
  return { user };
}

module.exports = { MAX_FAILED, LOCK_MINUTES, recordAttempt, registerFailure, registerSuccess, unlock, checkCredentials };