/**
 * AF-141 Session management (admin). Mounted inside adminRoutes: needs an admin console session, and writes are
 * audit-logged.
 *   GET    /api/admin/sessions                   open sessions (or recently ended ones), newest activity first
 *   DELETE /api/admin/sessions/:id               ends one session: its token stops working at once
 *   POST   /api/admin/users/:id/sessions/end     ends every session of one person
 */
const express = require('express');
const mongoose = require('mongoose');
const Session = require('../models/Session');
const User = require('../models/User');
const { authorize } = require('../middleware/auth');
const handleError = require('../utils/handleError');
const sessions = require('../utils/sessions');

const router = express.Router();
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const escapeRegex = (s) => String(s).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameOf = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();

router.get('/sessions', authorize('sessions'), async (req, res) => {
  try {
    const now = new Date();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = 25;
    const ended = req.query.status === 'ended';
    const filter = ended ? { $or: [{ endedAt: { $ne: null } }, { expiresAt: { $lte: now } }] } : sessions.openFilter(now);
    if (['admin', 'customer'].includes(req.query.portal)) filter.portal = req.query.portal;
    if (req.query.q) {
      const safe = escapeRegex(req.query.q);
      const people = await User.find({ $or: ['firstName', 'lastName', 'email'].map((f) => ({ [f]: { $regex: safe, $options: 'i' } })) }).select('_id').limit(200);
      const or = [{ user: { $in: people.map((p) => p._id) } }, { ip: { $regex: safe, $options: 'i' } }, { lastSeenIp: { $regex: safe, $options: 'i' } }];
      if (filter.$or) { filter.$and = [{ $or: filter.$or }, { $or: or }]; delete filter.$or; } else filter.$or = or;
    }
    const open = sessions.openFilter(now);
    const [total, list, adminOpen, customerOpen, people] = await Promise.all([
      Session.countDocuments(filter),
      Session.find(filter).sort(ended ? { endedAt: -1, expiresAt: -1 } : { lastSeenAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('user', 'firstName lastName email role').lean(),
      Session.countDocuments({ ...open, portal: 'admin' }),
      Session.countDocuments({ ...open, portal: 'customer' }),
      Session.distinct('user', open),
    ]);
    res.json({
      success: true, total, page, pages: Math.max(Math.ceil(total / limit), 1),
      counts: { admin: adminOpen, customer: customerOpen, people: people.length },
      keepDays: sessions.KEEP_DAYS,
      sessions: list.map((s) => sessions.view(s, req.sessionId, now)),
    });
  } catch (err) { handleError(res, err); }
});

router.delete('/sessions/:id', authorize('sessions'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Session not found', 404);
    if (String(req.params.id) === String(req.sessionId)) return bad(res, 'This is your own session on this device. Use Sign out instead.');
    const s = await Session.findById(req.params.id).populate('user', 'firstName lastName email');
    if (!s) return bad(res, 'Session not found', 404);
    const ended = await sessions.endOne(s._id, { reason: 'Ended by an admin', by: req.user });
    if (!ended) return bad(res, 'That session has already ended', 409);
    const who = s.user ? `${nameOf(s.user)} (${s.user.email})` : 'a deleted account';
    res.locals.auditDetail = `Ended a ${s.portal === 'admin' ? 'admin console' : 'customer site'} session of ${who}: ${sessions.describeAgent(s.userAgent)}, ${s.lastSeenIp || s.ip}`;
    res.json({ success: true, ended });
  } catch (err) { handleError(res, err); }
});

router.post('/users/:id/sessions/end', authorize('sessions'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Account not found', 404);
    const user = await User.findById(req.params.id).select('firstName lastName email');
    if (!user) return bad(res, 'Account not found', 404);
    const self = String(user._id) === String(req.user._id);
    // your own account: every other device, so this one stays signed in
    const ended = await sessions.endAllFor(user._id, { except: self ? req.sessionId : null, reason: 'Ended by an admin', by: req.user });
    res.locals.auditDetail = `Ended ${ended} session(s) of ${nameOf(user)} (${user.email})${self ? ', except this one' : ''}`;
    res.json({ success: true, ended });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
