const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/Session');
const sessions = require('../utils/sessions');
const { protect } = require('../middleware/auth');
const handleError = require('../utils/handleError');
const auditSecurityEvent = require('../utils/securityAudit');

// txRouter: write routes run as timestamped transactions (abort + restart on conflict)
const router = require('../utils/concurrency').txRouter(express.Router());

// Allowed avatar choices - keep in sync with OPTIONS in frontend/js/avatar.js
const AVATAR_OPTIONS = {
  skin: ['s1', 's2', 's3', 's4', 's5', 's6'],
  hair: ['short', 'buzz', 'curly', 'long', 'bun', 'ponytail', 'spiky', 'bob', 'none'],
  hairColor: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'],
  eyes: ['dot', 'happy', 'wink', 'sleepy', 'star'],
  brows: ['soft', 'raised', 'focused', 'none'],
  mouth: ['smile', 'grin', 'open', 'smirk', 'tongue'],
  facial: ['none', 'stubble', 'mustache', 'beard'],
  hat: ['none', 'cap', 'visor', 'headband', 'beanie'],
  glasses: ['none', 'round', 'square', 'shades'],
  shirt: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'],
  bg: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'],
};
function cleanAvatar(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const [key, allowed] of Object.entries(AVATAR_OPTIONS)) {
    if (input[key] !== undefined && !allowed.includes(input[key])) return null;
    out[key] = input[key] !== undefined ? input[key] : allowed[0];
  }
  return out;
}
router.use(protect);

/** UF-105 / AF-103 Profile - GET /api/users/profile (customers and admins) */
router.get('/profile', async (req, res) => {
  res.json({ success: true, user: req.user });
});

/** UF-106 / AF-103 Edit Profile - PUT /api/users/profile */
router.put('/profile', async (req, res) => {
  try {
    const { firstName, lastName, phone, avatar } = req.body;
    const user = await User.findById(req.user._id);
    if (avatar !== undefined) {
      const clean = cleanAvatar(avatar);
      if (!clean) return res.status(400).json({ success: false, message: 'That avatar choice is not available' });
      user.avatar = clean;
    }
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (phone !== undefined) user.phone = phone;
    if (typeof req.body.notifyEmail === 'boolean') user.notifyEmail = req.body.notifyEmail;
    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    handleError(res, err);
  }
});

/** UF-107 / AF-104 Change Password - PUT /api/users/change-password */
router.put('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Provide current password and a new password (min 8 characters)',
      });
    }
    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.matchPassword(currentPassword))) {
      // 400, not 401: a 401 means "signed out" to the pages, and a typo must not sign anyone out
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }
    user.password = newPassword;
    await user.save(); // ends every session of this account (models/User.js)
    auditSecurityEvent(req, { action: 'Password changed', user });
    // this device stays signed in with a new session; every other device was signed out
    const token = await sessions.start(req, user, { portal: req.tokenScope === 'admin' ? 'admin' : 'customer', method: 'password-change' });
    res.json({ success: true, message: 'Password changed. Other devices were signed out.', token });
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* AF-141 Where am I signed in? Customers and staff, for their own account */
/* ------------------------------------------------------------------ */
/** GET /api/users/sessions - this account's open sessions, this one first */
router.get('/sessions', async (req, res) => {
  try {
    const list = await Session.find({ user: req.user._id, ...sessions.openFilter() }).sort({ lastSeenAt: -1 }).lean();
    const views = list.map((s) => sessions.view(s, req.sessionId)).sort((a, b) => Number(b.current) - Number(a.current));
    res.json({ success: true, sessions: views });
  } catch (err) {
    handleError(res, err);
  }
});

/** POST /api/users/sessions/end-others - signs out every other device */
router.post('/sessions/end-others', async (req, res) => {
  try {
    const ended = await sessions.endAllFor(req.user._id, { except: req.sessionId, reason: 'Signed out from another device' });
    auditSecurityEvent(req, { action: 'Signed out other devices', user: req.user, detail: `${ended} session(s) ended` });
    res.json({ success: true, ended });
  } catch (err) {
    handleError(res, err);
  }
});

/** DELETE /api/users/sessions/:id - signs out one device (your own sessions only) */
router.delete('/sessions/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Session not found' });
    const ended = await sessions.end({ _id: req.params.id, user: req.user._id }, { reason: 'Signed out from another device' });
    if (!ended) return res.status(404).json({ success: false, message: 'That session has already ended' });
    auditSecurityEvent(req, { action: 'Signed out a device', user: req.user });
    res.json({ success: true, ended, signedOut: String(req.params.id) === String(req.sessionId) });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
