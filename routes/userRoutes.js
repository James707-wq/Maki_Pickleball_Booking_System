const express = require('express');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const handleError = require('../utils/handleError');
const auditSecurityEvent = require('../utils/securityAudit');

const router = express.Router();
router.use(protect);

/** UF-105 / AF-103 Profile - GET /api/users/profile (customers and admins) */
router.get('/profile', async (req, res) => {
  res.json({ success: true, user: req.user });
});

/** UF-106 / AF-103 Edit Profile - PUT /api/users/profile */
router.put('/profile', async (req, res) => {
  try {
    const { firstName, lastName, phone } = req.body;
    const user = await User.findById(req.user._id);
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (phone !== undefined) user.phone = phone;
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
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    user.password = newPassword;
    await user.save();
    auditSecurityEvent(req, { action: 'Password changed', user });
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
