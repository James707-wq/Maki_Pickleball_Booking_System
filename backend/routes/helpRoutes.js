/**
 * SF-136 Help/Support. Mounted inside adminRoutes; writes are audit-logged.
 *   GET   /api/admin/help/mine        my help requests + who the administrators are
 *   POST  /api/admin/help             ask the administrators (they are alerted)
 *   POST  /api/admin/help/:id/reply   the asker or an admin answers in the thread (the other side is told)
 *   PATCH /api/admin/help/:id         close or reopen
 *   GET   /api/admin/help?status=     admins: every request, with counts
 */
const express = require('express');
const mongoose = require('mongoose');
const HelpRequest = require('../models/HelpRequest');
const User = require('../models/User');
const { authorize } = require('../middleware/auth');
const { can, PERMISSIONS } = require('../config/permissions');
const U = require('../utils/bookingUtils');
const C = require('../utils/concurrency');
const handleError = require('../utils/handleError');

const router = express.Router();
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const { TOPICS } = HelpRequest;
const TOPIC_LABEL = { how_to: 'How do I...?', problem: 'Something is not working', account: 'My account or access', schedule: 'My shift or schedule', other: 'Something else' };
const STATUS = ['open', 'answered', 'closed'];
const nameOf = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();
const MINE = { link: '#/help' };
const DESK = { link: '#/helpdesk' };

/** The request if this account may see it (its own, or an admin who answers help requests). */
async function readable(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  const r = await HelpRequest.findById(req.params.id);
  if (!r) return null;
  return String(r.user) === String(req.user._id) || can(req.user.role, 'help') ? r : null;
}

router.get('/help/mine', authorize('dashboard'), async (req, res) => {
  try {
    const helpers = Object.keys(PERMISSIONS).filter((r) => r !== 'user' && PERMISSIONS[r].includes('help'));
    const [requests, admins] = await Promise.all([
      HelpRequest.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(50).lean(),
      User.find({ role: { $in: helpers }, isActive: { $ne: false } }).select('firstName lastName email phone').sort({ firstName: 1 }).limit(10).lean(),
    ]);
    res.json({ success: true, requests, topics: TOPICS.map((id) => ({ id, label: TOPIC_LABEL[id] })),
      contacts: admins.map((a) => ({ name: nameOf(a), email: a.email, phone: a.phone || '' })) });
  } catch (err) { handleError(res, err); }
});

router.post('/help', authorize('dashboard'), async (req, res) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    const topic = TOPICS.includes(req.body.topic) ? req.body.topic : 'other';
    const urgent = req.body.urgent === true || req.body.urgent === 'true' || req.body.urgent === 'on';
    if (subject.length < 3) return bad(res, 'Write a short subject, e.g. "Receipt printer not working"');
    if (message.length < 5) return bad(res, 'Write what you need help with');
    const who = nameOf(req.user);
    const r = await HelpRequest.create({ user: req.user._id, userName: who, userRole: req.user.role, topic, subject: subject.slice(0, 120), message: message.slice(0, 2000), urgent });
    await U.notifyStaff(`${urgent ? 'URGENT help request' : 'Help request'} from ${who}: ${r.subject}`, 'help', { except: req.user._id, ...DESK });
    res.locals.auditDetail = `${urgent ? 'Urgent: ' : ''}${r.subject} (${TOPIC_LABEL[topic]})`;
    res.status(201).json({ success: true, request: r });
  } catch (err) { handleError(res, err); }
});

router.post('/help/:id/reply', authorize('dashboard'), async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return bad(res, 'Write your reply first');
    const r = await readable(req);
    if (!r) return bad(res, 'Help request not found', 404);
    const mine = String(r.user) === String(req.user._id);
    r.replies.push({ by: req.user._id, byName: nameOf(req.user), byRole: req.user.role, message: message.slice(0, 2000) });
    r.status = mine ? 'open' : (req.body.status === 'closed' ? 'closed' : 'answered');
    await r.save();
    if (mine) await U.notifyStaff(`${nameOf(req.user)} replied about "${r.subject}": ${message.slice(0, 160)}`, 'help', { except: req.user._id, ...DESK });
    else await U.notify(r.user, `${nameOf(req.user)} answered your help request "${r.subject}": ${message.slice(0, 160)}`, undefined, MINE);
    res.locals.auditDetail = `Reply on "${r.subject}"`;
    res.json({ success: true, request: r });
  } catch (err) { handleError(res, err); }
});

router.patch('/help/:id', authorize('dashboard'), async (req, res) => {
  try {
    if (!['open', 'closed'].includes(req.body.status)) return bad(res, 'Choose open or closed');
    const r = await readable(req);
    if (!r) return bad(res, 'Help request not found', 404);
    C.assertFresh(req, r, 'help request');
    if (r.status === req.body.status) return bad(res, `This request is already ${req.body.status}`);
    r.status = req.body.status;
    await r.save();
    if (String(r.user) !== String(req.user._id)) await U.notify(r.user, `Your help request "${r.subject}" was ${r.status === 'closed' ? 'closed' : 'reopened'} by ${nameOf(req.user)}.`, undefined, MINE);
    res.locals.auditDetail = `"${r.subject}" ${r.status === 'closed' ? 'closed' : 'reopened'}`;
    res.json({ success: true, request: r });
  } catch (err) { handleError(res, err); }
});

router.get('/help', authorize('help'), async (req, res) => {
  try {
    const filter = STATUS.includes(req.query.status) ? { status: req.query.status } : {};
    const [requests, counts] = await Promise.all([
      HelpRequest.find(filter).sort({ updatedAt: -1 }).limit(200).lean(),
      HelpRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const c = { open: 0, answered: 0, closed: 0 };
    counts.forEach((x) => { c[x._id] = x.n; });
    // urgent open requests first
    requests.sort((a, b) => (b.status === 'open' && b.urgent) - (a.status === 'open' && a.urgent));
    res.json({ success: true, requests, counts: c, topics: TOPICS.map((id) => ({ id, label: TOPIC_LABEL[id] })) });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
