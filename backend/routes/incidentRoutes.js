/**
 * SF-130 Incident Reporting. Mounted inside adminRoutes: needs a staff/admin console session; writes are audit-logged.
 *   GET   /api/admin/incidents?status=open&q=&date=   incidents, open first (serious first), with counts
 *   POST  /api/admin/incidents                          staff record what happened (optionally for a booking)
 *   POST  /api/admin/incidents/:id/note                 add a detail or a follow-up
 *   PATCH /api/admin/incidents/:id                      admins: resolve or reopen (the reporter is told)
 */
const express = require('express');
const mongoose = require('mongoose');
const Incident = require('../models/Incident');
const Booking = require('../models/Booking');
const Court = require('../models/Court');
const { authorize } = require('../middleware/auth');
const { can } = require('../config/permissions');
const U = require('../utils/bookingUtils');
const C = require('../utils/concurrency');
const handleError = require('../utils/handleError');

const router = express.Router();
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const escapeRegex = (s) => String(s).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { CATEGORIES } = Incident;
const CATEGORY_LABEL = {
  injury: 'Injury or first aid', dispute: 'Argument or complaint', damage: 'Damage by a player', rules: 'Facility rules broken',
  no_show: 'No-show or very late', lost_item: 'Lost or found item', safety: 'Safety hazard', other: 'Something else',
};
const STATUS_LABEL = { open: 'Open', resolved: 'Resolved' };
const nameOf = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();
const anyRole = authorize('incidents', 'incidents.report');
const LINK = { link: '#/incidents' };

router.get('/incidents', anyRole, async (req, res) => {
  try {
    const filter = {};
    if (STATUS_LABEL[req.query.status]) filter.status = req.query.status;
    if (req.query.q) {
      const re = { $regex: escapeRegex(req.query.q), $options: 'i' };
      filter.$or = ['title', 'details', 'customerName', 'referenceNumber', 'courtName', 'reportedByName'].map((f) => ({ [f]: re }));
    }
    if (U.isDateStr(req.query.date)) {
      const start = U.manilaMidnight(req.query.date);
      filter.occurredAt = { $gte: start, $lt: new Date(start.getTime() + 864e5) };
    }
    const [incidents, counts] = await Promise.all([
      Incident.find(filter).sort({ status: 1, occurredAt: -1 }).limit(200).lean(), // 'open' sorts before 'resolved'
      Incident.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    // serious ones first among the open ones; newest first otherwise
    incidents.sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1)
      || (a.status === 'open' && (a.severity === 'serious' ? 0 : 1) - (b.severity === 'serious' ? 0 : 1))
      || new Date(b.occurredAt) - new Date(a.occurredAt));
    const byStatus = { open: 0, resolved: 0 };
    counts.forEach((c) => { byStatus[c._id] = c.n; });
    res.json({ success: true, incidents, counts: byStatus, categories: CATEGORIES.map((id) => ({ id, label: CATEGORY_LABEL[id] })) });
  } catch (err) { handleError(res, err); }
});

router.post('/incidents', anyRole, async (req, res) => {
  try {
    const { bookingId, courtId, category, severity = 'minor' } = req.body;
    const title = String(req.body.title || '').trim();
    if (!CATEGORIES.includes(category)) return bad(res, 'Choose what kind of incident it was');
    if (!['minor', 'serious'].includes(severity)) return bad(res, 'Choose how serious it was');
    if (title.length < 3) return bad(res, 'Say in a few words what happened, e.g. "Player twisted an ankle"');
    let booking = null;
    let court = null;
    if (bookingId) {
      if (!mongoose.isValidObjectId(bookingId)) return bad(res, 'Booking not found', 404);
      booking = await Booking.findById(bookingId).populate('user', 'firstName lastName');
      if (!booking) return bad(res, 'Booking not found', 404);
      court = { _id: booking.court, name: booking.courtName };
    } else if (courtId) {
      if (!mongoose.isValidObjectId(courtId)) return bad(res, 'Court not found', 404);
      court = await Court.findById(courtId).select('name');
      if (!court) return bad(res, 'Court not found', 404);
    }
    let occurredAt = new Date();
    if (req.body.occurredAt) {
      const t = new Date(req.body.occurredAt);
      if (Number.isNaN(t.getTime())) return bad(res, 'When did it happen?');
      if (t.getTime() > Date.now() + 5 * 60000) return bad(res, 'That time is still to come. When did it happen?');
      if (t.getTime() < Date.now() - 31 * 864e5) return bad(res, 'Record incidents within a month of when they happened');
      occurredAt = t;
    }
    const who = nameOf(req.user);
    const incident = await Incident.create({
      booking: booking ? booking._id : undefined,
      referenceNumber: booking ? booking.referenceNumber : '',
      customerName: booking ? U.customerName(booking) : String(req.body.customerName || '').trim().slice(0, 120),
      court: court ? court._id : undefined,
      courtName: court ? court.name : '',
      occurredAt, category, severity,
      title: title.slice(0, 100),
      details: String(req.body.details || '').trim().slice(0, 2000),
      actionTaken: String(req.body.actionTaken || '').trim().slice(0, 1000),
      reportedBy: req.user._id, reportedByName: who,
      updates: [{ byName: who, byRole: req.user.role, message: 'Recorded', status: 'open' }],
    });
    const where = [incident.courtName, incident.customerName].filter(Boolean).join(', ');
    await U.notifyStaff(`${severity === 'serious' ? 'SERIOUS incident' : 'Incident'} recorded by ${who}: ${incident.title}${where ? ` (${where})` : ''}.`,
      'incidents', { except: req.user._id, ...LINK });
    res.locals.auditDetail = `${severity === 'serious' ? 'Serious: ' : ''}${incident.title}${where ? ` (${where})` : ''} - ${CATEGORY_LABEL[category]}`;
    res.status(201).json({ success: true, incident });
  } catch (err) { handleError(res, err); }
});

router.post('/incidents/:id/note', anyRole, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Incident not found', 404);
    const message = String(req.body.message || '').trim();
    if (!message) return bad(res, 'Write the note first');
    const incident = await Incident.findById(req.params.id);
    if (!incident) return bad(res, 'Incident not found', 404);
    incident.updates.push({ byName: nameOf(req.user), byRole: req.user.role, message: message.slice(0, 1000) });
    await incident.save();
    if (String(incident.reportedBy) !== String(req.user._id)) {
      await U.notify(incident.reportedBy, `Update on the incident "${incident.title}": ${message.slice(0, 200)}`, undefined, LINK);
    }
    if (!can(req.user.role, 'incidents')) { // staff follow-ups go to the people who handle incidents
      await U.notifyStaff(`Note on the incident "${incident.title}" from ${nameOf(req.user)}: ${message.slice(0, 200)}`, 'incidents', { except: req.user._id, ...LINK });
    }
    res.locals.auditDetail = `Note on "${incident.title}"`;
    res.json({ success: true, incident });
  } catch (err) { handleError(res, err); }
});

router.patch('/incidents/:id', authorize('incidents'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Incident not found', 404);
    const { status } = req.body;
    if (!STATUS_LABEL[status]) return bad(res, 'Choose open or resolved');
    const message = String(req.body.message || '').trim().slice(0, 1000);
    const incident = await Incident.findById(req.params.id);
    if (!incident) return bad(res, 'Incident not found', 404);
    C.assertFresh(req, incident, 'incident');
    if (incident.status === status) return bad(res, `This incident is already ${STATUS_LABEL[status].toLowerCase()}`);
    const who = nameOf(req.user);
    incident.status = status;
    if (status === 'resolved') { incident.resolvedAt = new Date(); incident.resolvedByName = who; } else { incident.resolvedAt = undefined; incident.resolvedByName = ''; }
    incident.updates.push({ byName: who, byRole: req.user.role, message, status });
    await incident.save();
    if (String(incident.reportedBy) !== String(req.user._id)) {
      await U.notify(incident.reportedBy, `The incident "${incident.title}" is now ${STATUS_LABEL[status].toLowerCase()}${message ? `: ${message.slice(0, 200)}` : '.'}`, undefined, LINK);
    }
    res.locals.auditDetail = `"${incident.title}" ${status === 'resolved' ? 'resolved' : 'reopened'}`;
    res.json({ success: true, incident });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
