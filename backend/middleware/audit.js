const AuditLog = require('../models/AuditLog');

/**
 * AF-135 Audit Logs. Mount after `protect`. Every successful admin-console write (POST/PUT/PATCH/DELETE)
 * is recorded with who did it and a plain-English description. GET requests are not logged.
 * Only whitelisted body fields are kept, so passwords, PINs and one-time codes never reach the log.
 * A route can set res.locals.auditDetail to describe the change itself.
 */
const SAFE = ['status', 'paymentStatus', 'paymentMethod', 'role', 'isActive', 'reason', 'price', 'pricePerHour', 'name', 'date', 'startTime', 'action', 'audience', 'amount', 'rating', 'code', 'title'];

const RULES = [
  [/^POST \/users$/, 'Created an account'],
  [/^PUT \/users\/[^/]+$/, 'Edited an account'],
  [/^PATCH \/users\/[^/]+\/active$/, 'Activated or deactivated an account'],
  [/^PATCH \/users\/[^/]+\/role$/, 'Changed an account role'],
    [/^PATCH \/users\/[^/]+\/unlock$/, 'Unlocked a locked account'],
  [/^POST \/courts$/, 'Added a court'],
  [/^PUT \/courts\/[^/]+$/, 'Edited a court'],
  [/^PATCH \/courts\/[^/]+\/status$/, 'Changed a court status'],
  [/^PATCH \/courts\/[^/]+\/price$/, 'Changed a court price'],
  [/^DELETE \/courts\/[^/]+$/, 'Removed a court'],
  [/^PUT \/settings$/, 'Updated hours, booking rules or cancellation policy'],
  [/^POST \/blocks$/, 'Blocked a time slot'],
  [/^DELETE \/blocks\/[^/]+$/, 'Unblocked a time slot'],
  [/^POST \/bookings$/, 'Made a walk-in booking'],
  [/^POST \/maintenance$/, 'Reported a maintenance problem'],
  [/^POST \/maintenance\/[^/]+\/note$/, 'Added a note to a maintenance report'],
  [/^PATCH \/maintenance\/[^/]+$/, 'Updated a maintenance report'],
  [/^POST \/incidents$/, 'Recorded an incident'],
  [/^POST \/incidents\/[^/]+\/note$/, 'Added a note to an incident'],
  [/^PATCH \/incidents\/[^/]+$/, 'Resolved or reopened an incident'],
  [/^POST \/shifts$/, 'Assigned a shift'],
  [/^PUT \/shifts\/[^/]+$/, 'Changed a shift'],
  [/^DELETE \/shifts\/[^/]+$/, 'Removed a shift'],
  [/^POST \/help$/, 'Asked the administrators for help'],
  [/^POST \/help\/[^/]+\/reply$/, 'Replied to a help request'],
  [/^PATCH \/help\/[^/]+$/, 'Closed or reopened a help request'],
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
  [/^POST \/integrations\/verify$/, 'Asked for a code to change integrations'],
  [/^POST \/integrations\/verify\/resend$/, 'Asked for a new integration code'],
  [/^PUT \/integrations$/, 'Turned integrations on or off'],
  [/^POST \/integrations\/webhook\/verify$/, 'Asked for a code to change the custom API'],
  [/^POST \/integrations\/webhook\/verify\/resend$/, 'Asked for a new custom API code'],
  [/^PUT \/integrations\/webhook$/, 'Changed the custom API (webhook)'],
  [/^POST \/integrations\/webhook\/test$/, 'Sent a custom API test event'],
  [/^POST \/integrations\/webhook\/deliveries\/[^/]+\/retry$/, 'Sent a custom API event again'],
  [/^POST \/integrations\/reset\/verify$/, 'Asked for a code to reset integrations'],
  [/^POST \/integrations\/reset\/verify\/resend$/, 'Asked for a new integration reset code'],
  [/^PUT \/integrations\/reset$/, 'Reset integrations to defaults'],
  [/^POST \/api-tokens\/verify$/, 'Asked for a code to make an API token'],
  [/^POST \/api-tokens\/verify\/resend$/, 'Asked for a new API token code'],
  [/^POST \/api-tokens$/, 'Made an API token'],
  [/^DELETE \/api-tokens\/[^/]+$/, 'Revoked an API token'],
  [/^PUT \/security\/pin$/, 'Set the security PIN'],
  [/^DELETE \/sessions\/[^/]+$/, 'Ended a session'],
  [/^POST \/users\/[^/]+\/sessions\/end$/, "Ended an account's sessions"],
  [/^POST \/backups$/, 'Made a backup'],
  [/^PUT \/backups\/settings$/, 'Changed automatic backups'],
  [/^POST \/backups\/upload$/, 'Uploaded a backup file'],
  [/^POST \/backups\/verify$/, 'Asked for a code for a backup'],
  [/^POST \/backups\/verify\/resend$/, 'Asked for a new backup code'],
  [/^POST \/backups\/download$/, 'Downloaded a backup'],
  [/^POST \/backups\/restore$/, 'Restored a backup'],
  [/^POST \/backups\/delete$/, 'Deleted a backup'],
  [/^POST \/data\/checks\/[^/]+\/fix$/, 'Fixed a data problem'],
  [/^POST \/data\/cleanup\/[^/]+$/, 'Deleted old records'],
];

module.exports = (req, res, next) => {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user || res.locals.noAudit) return; // noAudit: a POST that only checks, changing nothing
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
      detail: res.locals.auditDetail || detail,
    }).catch((err) => console.error('Audit log failed:', err.message));
  });
  next();
};
