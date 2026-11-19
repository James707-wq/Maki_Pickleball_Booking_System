const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { can } = require('../config/permissions');
const sessions = require('../utils/sessions');

/**
 * Protects routes that require a logged-in user. Expects: Authorization: Bearer <token>
 * Rejects deactivated accounts, tokens issued before the last password change, and tokens whose
 * session was ended or expired (AF-141, utils/sessions.js). Sets req.user and req.sessionId.
 */
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    req.tokenScope = decoded.scope || '';
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }
    if (req.user.isActive === false) {
      return res.status(401).json({ success: false, message: 'Not authorized, account is deactivated' });
    }
    if (req.user.passwordChangedAt && decoded.iat < Math.floor(req.user.passwordChangedAt.getTime() / 1000)) {
      return res.status(401).json({ success: false, message: 'Not authorized, password was changed' });
    }
    const session = await sessions.check(decoded, req);
    if (!session.ok) return res.status(401).json({ success: false, code: 'SESSION_ENDED', message: session.message });
    req.sessionId = String(decoded.sid);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};

/** Allows the request only if the user's role grants at least one of the listed features. */
const authorize = (...features) => (req, res, next) => {
  if (features.some((f) => can(req.user.role, f))) return next();
  return res.status(403).json({ success: false, message: "You don't have access to this feature" });
};

/**
 * Admin console only accepts sessions from the admin sign-in page (password + Turnstile, or Google),
 * so the customer login can't be used to get around the admin sign-in checks.
 */
const adminSession = (req, res, next) => {
  if (req.tokenScope === 'admin') return next();
  return res.status(401).json({ success: false, message: 'Please sign in on the admin sign-in page' });
};

module.exports = { protect, authorize, adminSession };
