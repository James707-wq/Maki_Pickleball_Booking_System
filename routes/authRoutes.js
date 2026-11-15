const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const handleError = require('../utils/handleError');
const auditSecurityEvent = require('../utils/securityAudit');
const L = require('../utils/loginSecurity');

// txRouter: write routes run as timestamped transactions (abort + restart on conflict)
const router = require('../utils/concurrency').txRouter(express.Router());

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const userPayload = (u) => ({ id: u._id, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role });

/** UF-101 User Registration - POST /api/auth/register (always creates a customer) */
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please fill in all required fields' });
    }
    const existing = await User.findOne({ email: String(email).toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }
    const user = await User.create({ firstName, lastName, email, phone, password });
    res.status(201).json({ success: true, token: signToken(user._id), user: userPayload(user) });
  } catch (err) {
    handleError(res, err);
  }
});

/** UF-102 User Login - POST /api/auth/login */
router.post('/login', async (req, res) => {
  try {
    const result = await L.checkCredentials(req.body.email, req.body.password);
    if (result.code) {
      if (result.reason) L.recordAttempt(req, { portal: 'customer', success: false, reason: result.reason, user: result.user, email: req.body.email });
      auditSecurityEvent(req, { action: 'Failed customer sign-in', user: result.user, detail: result.reason || '', statusCode: result.code });
      return res.status(result.code).json({ success: false, message: result.message });
    }
    const { user } = result;
    await L.registerSuccess(user, req);
    L.recordAttempt(req, { portal: 'customer', success: true, reason: 'ok', user });
    auditSecurityEvent(req, { action: 'Customer signed in', user });
    res.json({ success: true, token: signToken(user._id), user: userPayload(user) });
  } catch (err) {
    handleError(res, err);
  }
});

/** AF-101 Admin Login - POST /api/auth/admin-login (staff and admin accounts only) */
router.post('/admin-login', async (req, res) => {
  try {
    const result = await L.checkCredentials(req.body.email, req.body.password);
    if (result.code) {
      if (result.reason) L.recordAttempt(req, { portal: 'admin', success: false, reason: result.reason, user: result.user, email: req.body.email });
      auditSecurityEvent(req, { action: 'Failed admin sign-in', user: result.user, detail: result.reason || '', statusCode: result.code });
      return res.status(result.code).json({ success: false, message: result.message });
    }
    const { user } = result;
    if (!['staff', 'admin'].includes(user.role)) {
      L.recordAttempt(req, { portal: 'admin', success: false, reason: 'no_admin_access', user });
      auditSecurityEvent(req, { action: 'Denied admin sign-in', user, detail: 'Account lacks staff access', statusCode: 403 });
      return res.status(403).json({ success: false, message: 'This account does not have admin access' });
    }
    await L.registerSuccess(user, req);
    L.recordAttempt(req, { portal: 'admin', success: true, reason: 'ok', user });
    auditSecurityEvent(req, { action: 'Admin signed in', user });
    res.json({ success: true, token: signToken(user._id), user: userPayload(user) });
  } catch (err) {
    handleError(res, err);
  }
});

/** UF-103 Forgot Password - POST /api/auth/forgot-password */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email ? String(email).toLowerCase() : null });

    if (!user) {
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent' });
    }

    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });
    const resetUrl = `${process.env.CLIENT_URL}/reset-password.html?token=${resetToken}`;

    try {
      await sendEmail({
        to: user.email,
        subject: "MAKI's PickleBall Court - Password Reset",
        html: `<p>Hi ${user.firstName},</p>
               <p>You requested a password reset. This link expires in 30 minutes:</p>
               <p><a href="${resetUrl}">${resetUrl}</a></p>
               <p>If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (emailErr) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: 'Email could not be sent' });
    }

    auditSecurityEvent(req, { action: 'Password reset email sent', user });
    res.json({ success: true, message: 'If that email exists, a reset link has been sent' });
  } catch (err) {
    handleError(res, err);
  }
});

/** UF-104 Password Reset - PUT /api/auth/reset-password/:resettoken */
router.put('/reset-password/:resettoken', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    const hashedToken = crypto.createHash('sha256').update(req.params.resettoken).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    }).select('+password +resetPasswordToken +resetPasswordExpire');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired' });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();
    await L.unlock(user._id); // proving email ownership unlocks a locked account

    auditSecurityEvent(req, { action: 'Password reset completed', user });
    res.json({ success: true, message: 'Password reset successful', token: signToken(user._id) });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;