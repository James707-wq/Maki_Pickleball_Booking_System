const AuditLog = require('../models/AuditLog');

const maskedEmail = (email) => {
  const [name, domain] = String(email || '').trim().toLowerCase().split('@');
  return name && domain ? `${name[0]}***@${domain}` : 'Unknown account';
};

module.exports = (req, { action, user, detail = '', statusCode = 200 }) => {
  const actorName = user
    ? `${user.firstName} ${user.lastName}`.trim()
    : maskedEmail(req.body?.email);

  AuditLog.create({
    actor: user?._id,
    actorName,
    actorRole: user?.role || '',
    action,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: String(req.get('user-agent') || '').slice(0, 512),
    statusCode,
    detail,
  }).catch((err) => console.error('Security audit failed:', err.message));
};