const express = require('express');
const Booking = require('../models/Booking');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const U = require('../utils/bookingUtils');
const handleError = require('../utils/handleError');

const router = express.Router();

/** UF-108 Dashboard - GET /api/dashboard */
router.get('/', protect, async (req, res) => {
  try {
    await U.autoCompleteBookings({ user: req.user._id });

    const now = new Date();
    const open = await Booking.find({ user: req.user._id, status: { $in: ['pending', 'confirmed'] } })
      .sort({ date: 1, startTime: 1 });
    const upcomingBookings = open.filter((b) => U.endInstant(b) > now);

    const totalBookings = await Booking.countDocuments({
      user: req.user._id,
      status: { $in: U.ACTIVE_STATUSES },
    });

    const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(10);

    res.json({
      success: true,
      data: {
        upcomingBookings,
        totalBookings,
        notifications,
        unreadNotifications: notifications.filter((n) => !n.read).length,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
