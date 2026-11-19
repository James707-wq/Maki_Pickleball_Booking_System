/**
 * Admin side of the API tokens (utils/apiTokens.js). Mounted inside adminRoutes, so every route already needs a signed-in
 * admin and writes are audit-logged.
 *   GET    /api/admin/api-tokens                 the tokens (never a token or its hash) and what the form needs
 *   POST   /api/admin/api-tokens/check           checks new settings, saves nothing (the form shows every problem)
 *   POST   /api/admin/api-tokens/verify          step 1: checks again, then the PIN, then sends a one-time code
 *   POST   /api/admin/api-tokens/verify/resend   a new code
 *   POST   /api/admin/api-tokens                 step 2: the code; makes the token and returns it this once
 *   DELETE /api/admin/api-tokens/:id             revokes a token (it stops working at once)
 */
const express = require('express');
const mongoose = require('mongoose');
const ApiToken = require('../models/ApiToken');
const { authorize } = require('../middleware/auth');
const handleError = require('../utils/handleError');
const twoStep = require('../utils/twoStep');
const T = require('../utils/apiTokens');

const router = express.Router();
const bad = (res, message, code = 400, extra = {}) => res.status(code).json({ success: false, message, ...extra });
const listText = (problems) => `${problems.join('. ')}.`;

router.get('/api-tokens', authorize('settings'), async (req, res) => {
  try {
    const tokens = await ApiToken.find().sort({ createdAt: -1 }).lean();
    const now = new Date();
    const order = { active: 0, expired: 1, revoked: 2 };
    res.json({
      success: true,
      tokens: tokens.map((t) => T.view(t, now)).sort((a, b) => order[a.status] - order[b.status]),
      scopes: T.scopeList,
      windows: Object.keys(T.WINDOWS),
      expiryDays: T.EXPIRY_DAYS,
      apiLimit: T.apiLimitNow(),
      maxActive: T.MAX_ACTIVE,
      baseUrl: `${req.protocol}://${req.get('host')}/api/v1`,
      security: twoStep.summary(req.user),
    });
  } catch (err) { handleError(res, err); }
});

/** Validated before saving: every problem at once, nothing written. */
router.post('/api-tokens/check', authorize('settings'), async (req, res) => {
  try {
    res.locals.noAudit = true; // only a check: nothing changes
    const r = await T.checkSettings(req.body);
    res.json({ success: true, ok: !r.problems, problems: r.problems || [], summary: r.settings ? T.describe(r.settings) : '' });
  } catch (err) { handleError(res, err); }
});

router.post('/api-tokens/verify', authorize('settings'), async (req, res) => {
  try {
    const r = await T.checkSettings(req.body);
    if (r.problems) return bad(res, listText(r.problems), 400, { problems: r.problems });
    const pin = await twoStep.checkPin(req, req.body.pin);
    if (!pin.ok) return twoStep.reply(res, pin);
    const what = T.describe(r.settings);
    const payload = { token: { ...r.settings, expiresAt: r.settings.expiresAt ? r.settings.expiresAt.toISOString() : null } };
    const ch = await twoStep.startChallenge(req, 'api-token', payload, what);
    if (!ch.ok) return twoStep.reply(res, ch);
    res.locals.auditDetail = `${what}; code sent to ${ch.sentTo.map((s) => s.label).join(', ')}`;
    res.json({ success: true, what, ...twoStep.challengeView(ch.challenge, ch.sentTo) });
  } catch (err) { handleError(res, err); }
});

router.post('/api-tokens/verify/resend', authorize('settings'), async (req, res) => {
  try {
    const r = await twoStep.resendChallenge(req, 'api-token', req.body.challengeId);
    if (!r.ok) return twoStep.reply(res, r);
    res.json({ success: true, ...twoStep.challengeView(r.challenge, r.sentTo) });
  } catch (err) { handleError(res, err); }
});

/** Step 2: makes exactly the token checked in step 1, if nothing clashes with it now. The token is in this answer only. */
router.post('/api-tokens', authorize('settings'), async (req, res) => {
  try {
    if (!req.body.challengeId) return bad(res, 'Making an API token needs your security PIN and a one-time code. Reload the page and try again.', 428);
    const r = await twoStep.useChallenge(req, 'api-token', req.body.challengeId, req.body.otp);
    if (!r.ok) return twoStep.reply(res, r);
    const s = r.challenge.payload && r.challenge.payload.token;
    if (!s || !s.name) return bad(res, 'Nothing to make');
    const settings = { name: s.name, scopes: s.scopes, rateLimit: s.rateLimit, expiresAt: s.expiresAt ? new Date(s.expiresAt) : null };
    if (settings.expiresAt && settings.expiresAt <= new Date()) return bad(res, 'The expiry date has passed in the meantime. Start again.', 409);
    const clash = await T.clashes(settings.name);
    if (clash.length) return bad(res, `${listText(clash)} Nothing was made.`, 409);
    const { token, hash, prefix } = T.newToken();
    const doc = await ApiToken.create({ ...settings, hash, prefix, createdBy: req.user._id, createdByName: `${req.user.firstName} ${req.user.lastName}`.trim() });
    const what = r.challenge.what || T.describe(settings);
    res.locals.auditDetail = `${what} (${prefix}..., confirmed with PIN and one-time code)`;
    const alertEmailed = twoStep.alertAdmins(req, what);
    res.status(201).json({ success: true, token, apiToken: T.view(doc), alertEmailed });
  } catch (err) { handleError(res, err); }
});

router.delete('/api-tokens/:id', authorize('settings'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Token not found', 404);
    const t = await ApiToken.findOneAndUpdate(
      { _id: req.params.id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedByName: `${req.user.firstName} ${req.user.lastName}`.trim() } },
      { new: true }
    );
    if (!t) return bad(res, 'That token is already revoked, or it does not exist', 409);
    res.locals.auditDetail = `Revoked API token "${t.name}" (${t.prefix}...)`;
    res.json({ success: true, apiToken: T.view(t) });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
