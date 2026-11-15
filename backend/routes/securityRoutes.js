/**
 * The signed-in admin's own security PIN, asked for (with an emailed one-time code) before integrations
 * are turned on or off. Mounted inside adminRoutes: needs an admin console session, and writes are audit-logged.
 */
const express = require('express');
const { authorize } = require('../middleware/auth');
const handleError = require('../utils/handleError');
const twoStep = require('../utils/twoStep');

const router = express.Router();

/** Create or change the PIN.   body: { password, pin }   (forgot the PIN? set a new one the same way) */
router.put('/security/pin', authorize('settings'), async (req, res) => {
  try {
    const r = await twoStep.setPin(req, req.body.password, req.body.pin);
    if (!r.ok) return twoStep.reply(res, r);
    res.locals.auditDetail = r.first ? 'Created a new PIN' : 'Changed the PIN';
    res.json({ success: true, message: r.first ? 'Security PIN created' : 'Security PIN changed', security: { pinSet: true, pinSetAt: r.setAt } });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
