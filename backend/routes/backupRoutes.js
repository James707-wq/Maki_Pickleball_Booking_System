/**
 * AF-138 Backup and restore, AF-139 Data management (admin). Mounted inside adminRoutes: every route needs an admin
 * console session, and writes are audit-logged. Taking data out (download), overwriting it (restore) and deleting a
 * backup need the security PIN and a one-time code (utils/twoStep.js), and every admin is alerted afterwards.
 *
 *   GET  /api/admin/backups                       saved backups, automatic backup settings, record counts
 *   POST /api/admin/backups                       make a backup now
 *   PUT  /api/admin/backups/settings              { auto, keep }
 *   POST /api/admin/backups/upload                a backup file (application/octet-stream), checked and saved
 *   POST /api/admin/backups/verify                step 1: { action: download|restore|delete, name, pin } -> code sent
 *   POST /api/admin/backups/verify/resend         { action, challengeId }
 *   POST /api/admin/backups/download              step 2: { challengeId, otp } -> the file
 *   POST /api/admin/backups/restore               step 2: { challengeId, otp } -> restored
 *   POST /api/admin/backups/delete                step 2: { challengeId, otp } -> deleted
 *   GET  /api/admin/data                          data checks, old records that can be cleaned up, record counts
 *   POST /api/admin/data/checks/:id/fix           fixes what one check found
 *   POST /api/admin/data/cleanup/:id              deletes old records of one kind
 */
const express = require('express');
const fs = require('fs');
const Settings = require('../models/Settings');
const { authorize } = require('../middleware/auth');
const handleError = require('../utils/handleError');
const twoStep = require('../utils/twoStep');
const sessions = require('../utils/sessions');
const B = require('../utils/backup');
const D = require('../utils/dataChecks');

const router = express.Router();
const ACTIONS = ['download', 'restore', 'delete'];
const bad = (res, message, code = 400, extra = {}) => res.status(code).json({ success: false, message, ...extra });
const fail = (res, err) => (err && err.name === 'BackupError' ? bad(res, err.message, err.status) : handleError(res, err));
const kindLabel = { manual: 'made by hand', auto: 'automatic', 'before-restore': 'made before a restore', uploaded: 'uploaded' };
const describe = (action, m) => {
  const what = `the backup from ${B.when(m.createdAt)} (${kindLabel[m.kind] || m.kind})`;
  if (action === 'restore') return `Restore ${what}: it replaces all current data`;
  if (action === 'download') return `Download ${what}`;
  return `Delete ${what}`;
};
const ALERT = { title: 'Backup & restore', did: 'used Backup & restore' };

router.get('/backups', authorize('data'), async (req, res) => {
  try {
    const s = await Settings.get();
    const [backups, data] = await Promise.all([B.list(), D.overview()]);
    res.json({
      success: true,
      backups: backups.map(B.view),
      settings: { auto: !(s.backup && s.backup.auto === false), keep: (s.backup && s.backup.keep) || 7 },
      folder: process.env.BACKUP_DIR ? 'BACKUP_DIR' : 'backend/backups',
      maxUploadMb: Math.round(B.MAX_UPLOAD_BYTES / 1048576),
      counts: data.counts,
      dataSize: data.dataSize,
      security: twoStep.summary(req.user),
    });
  } catch (err) { fail(res, err); }
});

router.post('/backups', authorize('data'), async (req, res) => {
  try {
    const { meta } = await B.create({ kind: 'manual', by: req.user });
    res.locals.auditDetail = `Made backup ${meta.name} (${B.view(meta).records} records)`;
    res.status(201).json({ success: true, backup: B.view(meta) });
  } catch (err) { fail(res, err); }
});

router.put('/backups/settings', authorize('data'), async (req, res) => {
  try {
    const auto = req.body.auto;
    const keep = Number(req.body.keep);
    if (typeof auto !== 'boolean') return bad(res, 'Choose whether automatic backups are on');
    if (!Number.isInteger(keep) || keep < 1 || keep > 60) return bad(res, 'Keep between 1 and 60 automatic backups');
    const s = await Settings.get();
    s.set('backup.auto', auto);
    s.set('backup.keep', keep);
    await s.save();
    res.locals.auditDetail = `Automatic backups ${auto ? `on, keeping the newest ${keep}` : 'off'}`;
    if (auto) await B.prune(keep);
    res.json({ success: true, settings: { auto, keep } });
  } catch (err) { fail(res, err); }
});

router.post('/backups/upload', authorize('data'),
  express.raw({ type: 'application/octet-stream', limit: B.MAX_UPLOAD_BYTES }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body)) return bad(res, 'Send the backup file as application/octet-stream');
      const { meta, missing } = await B.saveUploaded(req.body, { by: req.user });
      res.locals.auditDetail = `Uploaded backup file as ${meta.name}`;
      res.status(201).json({ success: true, backup: B.view(meta), missing });
    } catch (err) { fail(res, err); }
  });

/** Step 1: the backup must exist and (to restore) be readable before the PIN is even checked. */
router.post('/backups/verify', authorize('data'), async (req, res) => {
  try {
    const { action, name } = req.body;
    if (!ACTIONS.includes(action)) return bad(res, 'Unknown action');
    if (!B.isName(name)) return bad(res, 'Backup not found', 404);
    const meta = (await B.list()).find((m) => m.name === name);
    if (!meta) return bad(res, 'Backup not found', 404);
    if (action !== 'delete') await B.read(name); // a damaged file is refused now, not after the code
    const pin = await twoStep.checkPin(req, req.body.pin);
    if (!pin.ok) return twoStep.reply(res, pin);
    const what = describe(action, meta);
    const ch = await twoStep.startChallenge(req, `backup-${action}`, { name }, what);
    if (!ch.ok) return twoStep.reply(res, ch);
    res.locals.auditDetail = `${what}; code sent to ${ch.sentTo.map((s) => s.label).join(', ')}`;
    res.json({ success: true, what, ...twoStep.challengeView(ch.challenge, ch.sentTo) });
  } catch (err) { fail(res, err); }
});

router.post('/backups/verify/resend', authorize('data'), async (req, res) => {
  try {
    if (!ACTIONS.includes(req.body.action)) return bad(res, 'Unknown action');
    const r = await twoStep.resendChallenge(req, `backup-${req.body.action}`, req.body.challengeId);
    if (!r.ok) return twoStep.reply(res, r);
    res.json({ success: true, ...twoStep.challengeView(r.challenge, r.sentTo) });
  } catch (err) { fail(res, err); }
});

/** Step 2 for every action: the code approves exactly the backup it was asked for. */
async function confirmed(req, res, action) {
  if (!req.body.challengeId) {
    bad(res, 'This needs your security PIN and a one-time code. Reload the page and try again.', 428);
    return null;
  }
  const r = await twoStep.useChallenge(req, `backup-${action}`, req.body.challengeId, req.body.otp);
  if (!r.ok) { twoStep.reply(res, r); return null; }
  return { name: r.challenge.payload && r.challenge.payload.name, what: r.challenge.what };
}

router.post('/backups/download', authorize('data'), async (req, res) => {
  try {
    const c = await confirmed(req, res, 'download');
    if (!c) return;
    await B.read(c.name); // still there and readable
    res.locals.auditDetail = `${c.what} (confirmed with PIN and one-time code)`;
    twoStep.alertAdmins(req, c.what, ALERT);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${c.name}"`);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(B.fileOf(c.name)).pipe(res);
  } catch (err) { fail(res, err); }
});

router.post('/backups/restore', authorize('data'), async (req, res) => {
  try {
    const c = await confirmed(req, res, 'restore');
    if (!c) return;
    const result = await B.restore(c.name, { by: req.user });
    // Everyone else signs in again (their accounts may have changed). The admin who restored stays signed in if
    // their account is in the backup as an active admin.
    const User = require('../models/User');
    const me = await User.findById(req.user._id).select('role isActive').lean();
    const stay = Boolean(me && me.role === 'admin' && me.isActive !== false);
    const ended = await sessions.end(stay ? { _id: { $ne: req.sessionId } } : {}, { reason: 'Backup restored', by: req.user });
    res.locals.auditDetail = `${c.what}. Safety backup of the data before: ${result.safety.name}. ${ended} session(s) ended.`;
    twoStep.alertAdmins(req, `${c.what.replace(/: it replaces all current data$/, '')}. The data from before was saved as ${result.safety.name}`, ALERT);
    res.json({
      success: true, restored: B.describeCounts(result.counts), missing: result.missing, safety: B.view(result.safety),
      transaction: result.transaction, sessionsEnded: ended, signedOut: !stay,
    });
  } catch (err) { fail(res, err); }
});

router.post('/backups/delete', authorize('data'), async (req, res) => {
  try {
    const c = await confirmed(req, res, 'delete');
    if (!c) return;
    await B.remove(c.name);
    res.locals.auditDetail = `${c.what} (confirmed with PIN and one-time code)`;
    twoStep.alertAdmins(req, c.what, ALERT);
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

/* ---------------- AF-139 data checks and clean-up ---------------- */
router.get('/data', authorize('data'), async (req, res) => {
  try {
    const [checks, cleanup, data] = await Promise.all([D.runAll(), D.cleanupView(), D.overview()]);
    res.json({ success: true, checks, cleanup, automatic: D.AUTOMATIC, counts: data.counts, dataSize: data.dataSize, checkedAt: new Date() });
  } catch (err) { fail(res, err); }
});

router.post('/data/checks/:id/fix', authorize('data'), async (req, res) => {
  try {
    const r = await D.fix(req.params.id);
    if (r.error) return bad(res, r.error, r.status);
    res.locals.auditDetail = `${r.message}${r.examples && r.examples.length ? ` (${r.examples.join(', ')}${r.fixed > r.examples.length ? ', ...' : ''})` : ''}`;
    res.json({ success: true, ...r });
  } catch (err) { fail(res, err); }
});

router.post('/data/cleanup/:id', authorize('data'), async (req, res) => {
  try {
    const r = await D.cleanup(req.params.id);
    if (r.error) return bad(res, r.error, r.status);
    res.locals.auditDetail = `Deleted ${r.deleted} old record(s): ${req.params.id}`;
    res.json({ success: true, ...r });
  } catch (err) { fail(res, err); }
});

module.exports = router;
