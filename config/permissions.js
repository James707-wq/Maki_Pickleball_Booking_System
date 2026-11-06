/**
 * Role -> feature access. Used by middleware/auth.js (authorize) and shown
 * in the admin "Roles & Access" screen (AF-107).
 */
const FEATURES = {
  dashboard: 'Admin dashboard',
  bookings: 'Manage, approve, cancel, reschedule bookings',
  payments: 'Manage booking payments',
  schedule: 'Court schedules & blocked slots',
  'courts.view': 'View courts',
  'courts.status': 'Change court status',
  'courts.manage': 'Add, edit, remove courts & court details',
  'courts.pricing': 'Change court prices',
  settings: 'Operating hours & booking rules',
  users: 'Customer account management',
  staff: 'Staff account management',
  roles: 'Assign roles & access',
  checkins: 'Customer check-in / check-out',
  feedback: 'View & manage customer feedback',
  issues: 'Respond to complaints & reported problems',
  notifications: 'Send notifications to customers',
  announcements: 'Create & publish announcements',
  promotions: 'Promotions & discounts',
  reports: 'Generate reports',
  analytics: 'Booking, revenue & user analytics',
  audit: 'View audit logs',
};

const ALL = Object.keys(FEATURES);

const PERMISSIONS = {
  admin: ALL,
  staff: ['dashboard', 'bookings', 'payments', 'schedule', 'courts.view', 'courts.status', 'checkins', 'feedback', 'issues'],
  user: [],
};

const can = (role, perm) => (PERMISSIONS[role] || []).includes(perm);

module.exports = { FEATURES, PERMISSIONS, can };
