const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { can } = require('../config/permissions');

/**
 * Protects routes that require a logged-in user. Expects: Authorization: Bearer <token>
 * Rejects deactivated accounts and tokens issued before the last password change.
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
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }
    if (req.user.isActive === false) {
      return res.status(401).json({ success: false, message: 'Not authorized, account is deactivated' });
    }
    if (req.user.passwordChangedAt && decoded.iat < Math.floor(req.user.passwordChangedAt.getTime() / 1000)) {
      return res.status(401).json({ success: false, message: 'Not authorized, password was changed' });
    }
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

module.exports = { protect, authorize };
