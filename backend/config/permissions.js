/**
 * Role -> feature access. Used by middleware/auth.js (authorize) and shown
 * in the admin "Roles & Access" screen (AF-107).
 */
const FEATURES = {
  dashboard: 'Dashboard and own account (profile, password)',
  bookings: 'Manage, approve, cancel, reschedule bookings; walk-in bookings',
  payments: 'Manage booking payments',
  schedule: 'Block and unblock time slots',
  'schedule.view': 'View court schedules',
  'courts.view': 'View courts',
  'courts.status': 'Change court status',
  'courts.manage': 'Add, edit, remove courts & court details',
  'courts.pricing': 'Change court prices',
  'maintenance.report': 'Report court and equipment problems',
  maintenance: 'Handle maintenance reports',
  'incidents.report': 'Record incidents during customer sessions',
  incidents: 'Handle incident reports',
  'reports.daily': 'Daily booking report and court usage',
  'shifts.view': 'See own shifts',
  shifts: 'Assign staff shifts',
  settings: 'Operating hours, booking rules & cancellation policy',
  users: 'Customer account management',
  staff: 'Staff account management',
  roles: 'Assign roles & access',
  checkins: 'Customer check-in / check-out',
  'feedback.view': 'Read customer feedback',
  feedback: 'View & manage customer feedback',
  issues: 'Respond to complaints & reported problems',
  notifications: 'Send notifications to customers',
  'announcements.view': 'Read announcements and staff instructions',
  announcements: 'Create & publish announcements',
  promotions: 'Promotions & discounts',
  reports: 'Generate reports',
  analytics: 'Booking, revenue & user analytics',
  audit: 'View audit logs',
  logins: 'Login history & account lockouts',
  sessions: 'See who is signed in & end sessions',
  data: 'Backups, restore & data checks',
  help: 'Answer help requests from staff',
};

const ALL = Object.keys(FEATURES);

const PERMISSIONS = {
  admin: ALL,
  // Staff features: Staff Login, Staff Dashboard, Profile Management, Change Password (My account); Booking Management,
  // Create Walk-in Booking, Booking Confirmation, Booking Cancellation, Rescheduling (SF-111), Status Update (SF-112),
  // Customer Information (SF-116), Court Assignment (SF-123) (bookings); View Court Availability, Court Status Update
  // (SF-121) (courts.view, courts.status); View Court Schedule, Daily Schedule (SF-124) (schedule.view); Booking
  // Verification, Check-in, Check-out (SF-113..115) (checkins); Payment Verification, Recording, Receipts, Refunds
  // (SF-117..120) (payments); Maintenance Reporting (SF-122) (maintenance.report). Booking Search and Filter (SF-125,
  // SF-126) (bookings); Notifications, Activity Log, Help/Support, Logout (SF-127, SF-135..137) (dashboard: every console
  // account); Announcements (SF-128) (announcements.view); Customer Feedback (SF-129) (feedback.view); Incident
  // Reporting (SF-130) (incidents.report); Daily Booking Report, Court Utilization (SF-131, SF-133) (reports.daily);
  // Payment Report for a shift (SF-132) (payments); Shift Information (SF-134) (shifts.view). Blocking slots, court
  // details and prices, accounts, reports and analytics, settings, security, assigning shifts and handling incident and
  // help reports stay with admins.
  staff: ['dashboard', 'bookings', 'schedule.view', 'courts.view', 'courts.status', 'checkins', 'payments', 'maintenance.report',
    'announcements.view', 'feedback.view', 'incidents.report', 'reports.daily', 'shifts.view'],
  user: [],
};

const can = (role, perm) => (PERMISSIONS[role] || []).includes(perm);

module.exports = { FEATURES, PERMISSIONS, can };
