/**
 * SF-122 Maintenance Reporting. Mounted inside adminRoutes: needs a staff/admin console session, and writes are
 * audit-logged.
 *   GET   /api/admin/maintenance?status=open        reports, newest first, with counts per status
 *   POST  /api/admin/maintenance                     staff report a problem; every admin is alerted
 *   POST  /api/admin/maintenance/:id/note            add a detail or an update
 *   PATCH /api/admin/maintenance/:id                 admins: set in progress / fixed (the reporter is told)
 */
const express = require('express');
const mongoose = require('mongoose');
const MaintenanceReport = require('../models/MaintenanceReport');
const Court = require('../models/Court');
const { authorize } = require('../middleware/auth');
const { can } = require('../config/permissions');
const U = require('../utils/bookingUtils');
const C = require('../utils/concurrency');
const handleError = require('../utils/handleError');

const router = express.Router();
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const { CATEGORIES } = MaintenanceReport;
const CATEGORY_LABEL = { court: 'Court surface or lines', net: 'Net or posts', lighting: 'Lights', equipment: 'Equipment (paddles, balls...)', facility: 'Facility (restroom, seats, doors...)', cleaning: 'Cleaning', other: 'Something else' };
const STATUS_LABEL = { open: 'Open', in_progress: 'Being fixed', fixed: 'Fixed' };
const nameOf = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();
const anyRole = authorize('maintenance', 'maintenance.report');
// open first, then being fixed, then fixed; urgent reports first among the ones not fixed; newest first
const RANK = { open: 0, in_progress: 1, fixed: 2 };
const SEVERITY = { urgent: 0, normal: 1, low: 2 };
const byPriority = (a, b) => RANK[a.status] - RANK[b.status]
  || (a.status !== 'fixed' && SEVERITY[a.severity] - SEVERITY[b.severity])
  || new Date(b.createdAt) - new Date(a.createdAt);

router.get('/maintenance', anyRole, async (req, res) => {
  try {
    const filter = {};
    if (Object.keys(STATUS_LABEL).includes(req.query.status)) filter.status = req.query.status;
    const [reports, counts] = await Promise.all([
      MaintenanceReport.find(filter).sort({ status: -1, createdAt: -1 }).limit(200).lean(), // 'open' > 'in_progress' > 'fixed'
      MaintenanceReport.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const byStatus = { open: 0, in_progress: 0, fixed: 0 };
    counts.forEach((c) => { byStatus[c._id] = c.n; });
    reports.sort(byPriority);
    res.json({ success: true, reports, counts: byStatus, categories: CATEGORIES.map((id) => ({ id, label: CATEGORY_LABEL[id] })) });
  } catch (err) { handleError(res, err); }
});

router.post('/maintenance', anyRole, async (req, res) => {
  try {
    const { courtId, category, severity = 'normal' } = req.body;
    const title = String(req.body.title || '').trim();
    const details = String(req.body.details || '').trim();
    if (!CATEGORIES.includes(category)) return bad(res, 'Choose what kind of problem it is');
    if (!['low', 'normal', 'urgent'].includes(severity)) return bad(res, 'Choose how urgent it is');
    if (title.length < 3) return bad(res, 'Say in a few words what is wrong, e.g. "Net torn on the left side"');
    let court = null;
    if (courtId) {
      if (!mongoose.isValidObjectId(courtId)) return bad(res, 'Court not found', 404);
      court = await Court.findById(courtId).select('name');
      if (!court) return bad(res, 'Court not found', 404);
    }
    const who = nameOf(req.user);
    const report = await MaintenanceReport.create({
      court: court ? court._id : undefined, courtName: court ? court.name : '', category, severity,
      title: title.slice(0, 100), details: details.slice(0, 2000), reportedBy: req.user._id, reportedByName: who,
      updates: [{ byName: who, byRole: req.user.role, message: 'Reported', status: 'open' }],
    });
    const where = court ? `${court.name}: ` : '';
    await U.notifyStaff(`${severity === 'urgent' ? 'URGENT maintenance' : 'Maintenance'} report from ${who}: ${where}${report.title}. See Courts -> Maintenance.`, 'maintenance', { link: '#/maintenance' });
    res.locals.auditDetail = `${severity === 'urgent' ? 'Urgent: ' : ''}${where}${report.title} (${CATEGORY_LABEL[category]})`;
    res.status(201).json({ success: true, report });
  } catch (err) { handleError(res, err); }
});

router.post('/maintenance/:id/note', anyRole, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Report not found', 404);
    const message = String(req.body.message || '').trim();
    if (!message) return bad(res, 'Write the note first');
    const report = await MaintenanceReport.findById(req.params.id);
    if (!report) return bad(res, 'Report not found', 404);
    report.updates.push({ byName: nameOf(req.user), byRole: req.user.role, message: message.slice(0, 1000) });
    await report.save();
    if (String(report.reportedBy) !== String(req.user._id)) {
      await U.notify(report.reportedBy, `Update on your maintenance report "${report.title}": ${message.slice(0, 200)}`, undefined, { link: '#/maintenance' });
    }
    // a note from staff (who can't change the status) goes to the people who handle reports
    if (!can(req.user.role, 'maintenance')) {
      await U.notifyStaff(`Note on maintenance report "${report.title}" from ${nameOf(req.user)}: ${message.slice(0, 200)}`, 'maintenance', { link: '#/maintenance' });
    }
    res.locals.auditDetail = `Note on "${report.title}"`;
    res.json({ success: true, report });
  } catch (err) { handleError(res, err); }
});

router.patch('/maintenance/:id', authorize('maintenance'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Report not found', 404);
    const { status } = req.body;
    if (!STATUS_LABEL[status]) return bad(res, 'Choose open, being fixed or fixed');
    const message = String(req.body.message || '').trim().slice(0, 1000);
    const report = await MaintenanceReport.findById(req.params.id);
    if (!report) return bad(res, 'Report not found', 404);
    C.assertFresh(req, report, 'report');
    if (report.status === status && !message) return bad(res, `This report is already "${STATUS_LABEL[status]}"`);
    const who = nameOf(req.user);
    report.status = status;
    if (status === 'fixed') { report.fixedAt = new Date(); report.fixedByName = who; } else { report.fixedAt = undefined; report.fixedByName = ''; }
    report.updates.push({ byName: who, byRole: req.user.role, message, status });
    await report.save();
    if (String(report.reportedBy) !== String(req.user._id)) await U.notify(report.reportedBy, `Your maintenance report "${report.title}" is now: ${STATUS_LABEL[status]}${message ? `. ${message.slice(0, 200)}` : ''}`, undefined, { link: '#/maintenance' });
    res.locals.auditDetail = `"${report.title}" set to ${STATUS_LABEL[status]}`;
    res.json({ success: true, report });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
