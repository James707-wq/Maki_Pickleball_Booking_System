const AuditLog = require('../models/AuditLog');

/**
 * AF-135 Audit Logs. Mount after `protect`. Every successful admin-console write (POST/PUT/PATCH/DELETE)
 * is recorded with who did it and a plain-English description. GET requests are not logged.
 * Only whitelisted body fields are kept, so passwords never reach the log.
 */
const SAFE = ['status', 'paymentStatus', 'paymentMethod', 'role', 'isActive', 'reason', 'price', 'pricePerHour', 'name', 'date', 'startTime', 'action', 'audience', 'amount', 'rating', 'code', 'title'];

const RULES = [
  [/^POST \/users$/, 'Created an account'],
  [/^PUT \/users\/[^/]+$/, 'Edited an account'],
  [/^PATCH \/users\/[^/]+\/active$/, 'Activated or deactivated an account'],
  [/^PATCH \/users\/[^/]+\/role$/, 'Changed an account role'],
  [/^POST \/courts$/, 'Added a court'],
  [/^PUT \/courts\/[^/]+$/, 'Edited a court'],
  [/^PATCH \/courts\/[^/]+\/status$/, 'Changed a court status'],
  [/^PATCH \/courts\/[^/]+\/price$/, 'Changed a court price'],
  [/^DELETE \/courts\/[^/]+$/, 'Removed a court'],
  [/^PUT \/settings$/, 'Updated hours and booking rules'],
  [/^POST \/blocks$/, 'Blocked a time slot'],
  [/^DELETE \/blocks\/[^/]+$/, 'Unblocked a time slot'],
  [/^PATCH \/bookings\/[^/]+\/status$/, 'Changed a booking status'],
  [/^PATCH \/bookings\/[^/]+\/reschedule$/, 'Rescheduled a booking'],
  [/^PATCH \/bookings\/[^/]+\/payment$/, 'Updated a booking payment'],
  [/^POST \/bookings\/[^/]+\/verify-payment$/, 'Verified or rejected a payment'],
  [/^POST \/bookings\/[^/]+\/refund$/, 'Processed a refund'],
  [/^PATCH \/bookings\/[^/]+\/checkin$/, 'Recorded a check-in or check-out'],
  [/^POST \/notifications$/, 'Sent a notification'],
  [/^POST \/announcements$/, 'Created an announcement'],
  [/^PUT \/announcements\/[^/]+$/, 'Edited an announcement'],
  [/^PATCH \/announcements\/[^/]+\/publish$/, 'Published or unpublished an announcement'],
  [/^DELETE \/announcements\/[^/]+$/, 'Deleted an announcement'],
  [/^POST \/promotions$/, 'Created a promotion'],
  [/^PUT \/promotions\/[^/]+$/, 'Edited a promotion'],
  [/^PATCH \/promotions\/[^/]+\/active$/, 'Turned a promotion on or off'],
  [/^DELETE \/promotions\/[^/]+$/, 'Deleted a promotion'],
  [/^PATCH \/feedback\/[^/]+$/, 'Updated customer feedback'],
  [/^POST \/issues\/[^/]+\/reply$/, 'Replied to a customer issue'],
  [/^PATCH \/issues\/[^/]+$/, 'Updated an issue status'],
];

module.exports = (req, res, next) => {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user) return;
    const path = req.path;
    const key = `${req.method} ${path}`;
    const rule = RULES.find(([re]) => re.test(key));
    const body = req.body || {};
    const detail = SAFE.filter((k) => body[k] !== undefined && body[k] !== '' && typeof body[k] !== 'object')
      .map((k) => `${k}: ${String(body[k]).slice(0, 60)}`).join(', ');
    AuditLog.create({
      actor: req.user._id,
      actorName: `${req.user.firstName} ${req.user.lastName}`,
      actorRole: req.user.role,
      action: rule ? rule[1] : `${req.method} ${path}`,
      method: req.method,
      path,
      ip: req.ip,
      userAgent: String(req.get('user-agent') || '').slice(0, 512),
      statusCode: res.statusCode,
      entityId: (path.match(/[0-9a-f]{24}/) || [''])[0],
      detail,
    }).catch((err) => console.error('Audit log failed:', err.message));
  });
  next();
};
