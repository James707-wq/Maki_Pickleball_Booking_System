/**
 * Customer-facing counterparts of the admin features:
 *   UF-130 announcements, UF-131 promotions, UF-133 feedback, UF-132/134 reports & support.
 * Mounted at /api, every route needs a logged-in user.
 */
const express = require('express');
const mongoose = require('mongoose');
const Announcement = require('../models/Announcement');
const Promotion = require('../models/Promotion');
const Feedback = require('../models/Feedback');
const Issue = require('../models/Issue');
const Booking = require('../models/Booking');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const handleError = require('../utils/handleError');

const router = express.Router();
router.use(protect);

router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ success: false, message: 'Not found' });
  next();
});
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });

/** UF-130 - GET /api/announcements */
router.get('/announcements', async (req, res) => {
  try {
    const items = await Announcement.find({ published: true }).sort({ publishedAt: -1 }).limit(10).select('title body publishedAt');
    res.json({ success: true, announcements: items });
  } catch (err) { handleError(res, err); }
});

/** UF-128 - GET /api/notifications */
router.get('/notifications', async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30);
    res.json({ success: true, notifications, unread: notifications.filter((n) => !n.read).length });
  } catch (err) { handleError(res, err); }
});

router.patch('/notifications/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findOne({ _id: req.params.id, user: req.user._id });
    if (!notification) return bad(res, 'Notification not found', 404);
    notification.read = true;
    await notification.save();
    res.json({ success: true, notification });
  } catch (err) { handleError(res, err); }
});

/** UF-131 - GET /api/promotions (only promos usable right now) */
router.get('/promotions', async (req, res) => {
  try {
    const all = await Promotion.find({ active: true }).sort({ createdAt: -1 }).limit(50);
    const promotions = all.filter((p) => !p.problem()).map((p) => ({
      code: p.code, title: p.title, description: p.description, type: p.type, value: p.value, endsAt: p.endsAt,
    }));
    res.json({ success: true, promotions });
  } catch (err) { handleError(res, err); }
});

/** POST /api/promotions/check  body: { code, fee } -> what the discount would be */
router.post('/promotions/check', async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const fee = Number(req.body.fee);
    if (!code) return bad(res, 'Enter a promo code');
    const p = await Promotion.findOne({ code });
    if (!p) return bad(res, 'That promo code is not valid', 404);
    const problem = p.problem();
    if (problem) return bad(res, problem);
    const discount = Number.isFinite(fee) && fee > 0 ? p.discountFor(fee) : 0;
    res.json({ success: true, code: p.code, title: p.title, discount, total: Math.max(fee - discount, 0) });
  } catch (err) { handleError(res, err); }
});

/** UF-133 - POST /api/feedback  body: { bookingId, rating, comment } (completed bookings only, once each) */
router.post('/feedback', async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!mongoose.isValidObjectId(bookingId)) return bad(res, 'Invalid booking');
    const booking = await Booking.findById(bookingId);
    if (!booking || booking.user.toString() !== req.user._id.toString()) return bad(res, 'Booking not found', 404);
    if (booking.status !== 'completed') return bad(res, 'You can review a booking once it is completed');
    const fb = await Feedback.create({
      user: req.user._id, booking: booking._id, court: booking.court, courtName: booking.courtName,
      rating: Number(req.body.rating), comment: req.body.comment,
    });
    res.status(201).json({ success: true, feedback: fb });
  } catch (err) { handleError(res, err); }
});

router.get('/feedback/booking/:id', async (req, res) => {
  try {
    const fb = await Feedback.findOne({ booking: req.params.id, user: req.user._id });
    res.json({ success: true, feedback: fb });
  } catch (err) { handleError(res, err); }
});

/** UF-134 - report a problem */
router.post('/issues', async (req, res) => {
  try {
    let booking;
    if (req.body.bookingId) {
      if (!mongoose.isValidObjectId(req.body.bookingId)) return bad(res, 'Invalid booking');
      booking = await Booking.findOne({ _id: req.body.bookingId, user: req.user._id });
      if (!booking) return bad(res, 'Booking not found', 404);
    }
    const issue = await Issue.create({
      user: req.user._id, booking: booking && booking._id, category: req.body.category,
      subject: req.body.subject, message: req.body.message,
    });
    res.status(201).json({ success: true, issue });
  } catch (err) { handleError(res, err); }
});

router.get('/issues/mine', async (req, res) => {
  try {
    const issues = await Issue.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(50).populate('booking', 'referenceNumber');
    res.json({ success: true, issues });
  } catch (err) { handleError(res, err); }
});

router.post('/issues/:id/reply', async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return bad(res, 'Write a message first');
    const issue = await Issue.findOne({ _id: req.params.id, user: req.user._id });
    if (!issue) return bad(res, 'Report not found', 404);
    issue.replies.push({ by: req.user._id, byRole: 'user', byName: `${req.user.firstName} ${req.user.lastName}`, message: message.slice(0, 2000) });
    if (issue.status === 'resolved') issue.status = 'open'; // customer wrote back: reopen
    await issue.save();
    res.json({ success: true, issue });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
