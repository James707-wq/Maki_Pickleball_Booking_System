'use strict';
/* =====================================================================
   MAKI's PickleBall Court - admin console
   Talks to /api/admin/* (and /api/users/* for the admin's own profile).
   ===================================================================== */

/* ---------- helpers ---------- */
const TOKEN_KEY = 'adminToken';
const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH');
const MANILA_MS = 8 * 3600e3; // Philippines = UTC+8, no DST
const toDateStr = (d) => new Date(new Date(d).getTime() + MANILA_MS).toISOString().slice(0, 10);
const todayStr = () => toDateStr(new Date());
const addDays = (str, n) => toDateStr(new Date(new Date(`${str}T00:00:00+08:00`).getTime() + n * 864e5));
const fmtDate = (d) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric' });
const fmtLong = (str) => new Date(`${str}T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = (str) => new Date(`${str}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const fmtStamp = (d) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const STATUS_LABEL = { pending: 'Pending approval', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Rejected' };
const PAY_LABEL = { pending: 'Unpaid', paid: 'Paid', failed: 'Failed', refunded: 'Refunded' };
const ROLE_LABEL = { user: 'Customer', staff: 'Staff', admin: 'Admin' };
const pillS = (s) => `<span class="pill s-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
const pillP = (p) => `<span class="pill p-${esc(p)}">${esc(PAY_LABEL[p] || p)}</span>`;
const pillC = (c) => `<span class="pill c-${esc(c)}">${esc(c)}</span>`;
const pillR = (r) => `<span class="pill r-${esc(r)}">${esc(ROLE_LABEL[r] || r)}</span>`;
const pillA = (on) => `<span class="pill ${on ? 'u-active' : 'u-off'}">${on ? 'Active' : 'Deactivated'}</span>`;
const custName = (b) => (b.user ? `${b.user.firstName} ${b.user.lastName}`
  : b.walkIn && b.walkIn.name ? `${b.walkIn.name} (walk-in)` : 'Deleted user');
const courtOf = (b) => (b.court && b.court.name) || b.courtName;

/* ---------- session + API ---------- */
const state = { me: null, perms: [] };
const can = (p) => state.perms.includes(p);

// remote: also end this session on the server (AF-144), so the token stops working at once, not just here
function signOut({ remote = false, reason = '' } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (remote && token) {
    try {
      fetch(`${window.API_ROOT || '/api'}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
    } catch (e) { /* signed out here anyway */ }
  }
  if (reason) { try { sessionStorage.setItem('adminSignedOutReason', reason); } catch (e) { /* storage off */ } }
  localStorage.removeItem(TOKEN_KEY);
  location.replace(window.PAGE ? window.PAGE('admin-login') : 'admin-login.html');
}

// version: the record's writeTS as displayed. Sent as If-Match so the server can refuse the change
// (409 WRITE_CONFLICT) when another staff member or the customer changed the record in the meantime.
async function request(url, { method = 'GET', body, version } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { signOut(); throw new Error('Please sign in'); }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (version) headers['If-Match'] = `"${new Date(version).toISOString()}"`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (res.status === 401) { signOut({ reason: data.message || '' }); throw new Error(data.message || 'Session expired'); }
  if (!res.ok || data.success === false) {
    const err = Object.assign(new Error(data.message || 'Something went wrong'), { status: res.status, code: data.code, data });
    // someone else changed this record: reload the list behind the dialog so it shows the latest data
    if (data.code === 'WRITE_CONFLICT') setTimeout(() => { try { refreshView(); } catch (e) { /* no list */ } }, 0);
    throw err;
  }
  return data;
}
const api = (path, opts) => request(`${window.API_ROOT || '/api'}/admin${path}`, opts);
const userApi = (path, opts) => request(`${window.API_ROOT || '/api'}/users${path}`, opts);

/**
 * Downloads a file from /api/admin${path} (CSV exports, backups) with this session, and saves it under the name the
 * server gives. Throws the server's message when it refuses (e.g. a wrong one-time code).
 */
async function downloadFile(path, fallbackName, btn = null, { method = 'GET', body } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { signOut(); throw new Error('Please sign in'); }
  if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
  try {
    const res = await fetch(`${window.API_ROOT || '/api'}/admin${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch (e) { /* not JSON */ }
      if (res.status === 401) signOut({ reason: data.message || '' });
      throw Object.assign(new Error(data.message || 'The download failed'), { status: res.status });
    }
    const blob = await res.blob();
    const name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || fallbackName;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return name;
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('is-busy'); }
  }
}

/* ---------- toast + modal ---------- */
let toastTimer;
function toast(text, isErr = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = (isErr ? 'err ' : '') + 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isErr ? 5000 : 2800);
}

const dlg = $('#modal');
const modalBody = $('#modalBody');
function openModal(title, html, { wide = false } = {}) {
  $('#modalTitle').textContent = title;
  modalBody.innerHTML = html;
  modalBody.onclick = null; modalBody.onsubmit = null; modalBody.onchange = null;
  dlg.classList.remove('closing'); // re-opened while the close animation was still running
  dlg.classList.toggle('wide', wide);
  if (!dlg.open) dlg.showModal();
}
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function closeModal() {
  if (!dlg.open || dlg.classList.contains('closing')) return;
  const finish = () => { if (!dlg.classList.contains('closing')) return; dlg.classList.remove('closing'); dlg.close(); };
  dlg.classList.add('closing');
  if (reducedMotion()) return finish();
  dlg.addEventListener('animationend', function done(e) {
    if (e.target !== dlg) return;
    dlg.removeEventListener('animationend', done);
    finish();
  });
  setTimeout(finish, 300); // safety net
}
dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(); }); // Esc key
$('#modalClose').addEventListener('click', closeModal);
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeModal(); }); // click on backdrop

function showErr(el, text) {
  if (!el) return toast(text, true);
  el.textContent = text;
  el.className = 'msg error';
}

/** Wire a form so submit disables the button, runs fn(data), and shows errors inline. */
function onSubmit(form, fn) {
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('.msg');
    if (err) err.className = 'msg error hidden';
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    try {
      const data = {};
      new FormData(form).forEach((v, k) => { data[k] = v; });
      form.querySelectorAll('input[type=checkbox]').forEach((c) => { data[c.name] = c.checked; });
      await fn(data);
    } catch (ex) {
      showErr(err, ex.message);
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('is-busy'); }
    }
  };
}

const field = (label, input, hint = '') => `<label class="f">${label}${input}${hint ? `<small>${hint}</small>` : ''}</label>`;
const optionList = (items, selected) => items.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(l)}</option>`).join('');
const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`;

/* ---------- shell: nav + header + router ---------- */
const VIEWS = {
  dashboard: { label: 'Dashboard', perm: 'dashboard', group: 'Overview', render: renderDashboard },
  bookings: { label: 'Bookings', perm: 'bookings', group: 'Operations', render: renderBookings },
  payments: { label: 'Payments', perm: 'payments', group: 'Operations', render: renderPayments },
  schedule: { label: 'Schedule', perm: 'schedule.view', group: 'Operations', render: renderSchedule },
  courts: { label: 'Courts', perm: 'courts.view', group: 'Facility', render: renderCourts },
  settings: { label: 'Hours & rules', perm: 'settings', group: 'Facility', render: renderSettings },
  location: { label: 'Location', perm: 'settings', group: 'Facility', render: renderLocation },
  integrations: { label: 'Integrations', perm: 'settings', group: 'Facility', render: renderIntegrationsPage },
  tokens: { label: 'API tokens', perm: 'settings', group: 'Security', render: renderApiTokens },
  customers: { label: 'Customers', perm: 'users', group: 'People', render: renderCustomers },
  staff: { label: 'Staff', perm: 'staff', group: 'People', render: renderStaff },
  roles: { label: 'Roles & access', perm: 'roles', group: 'People', render: renderRoles },
  profile: { label: 'My account', perm: 'dashboard', group: 'Account', render: renderProfile },
};
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  bookings: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 15l2 2 4-4"/>',
  payments: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  courts: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16M3 12h18"/>',
  settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h12M20 17h0"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="17" r="2"/>',
  customers: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  staff: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.6a3.5 3.5 0 010 6.8M18.5 14.8c2 .8 3 2.4 3 5.2"/>',
  roles: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  profile: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5c1.5-2 3.3-3 5.5-3s4 1 5.5 3"/>',
  integrations: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 01-12 0zM12 17v5"/>',
  location: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
};
Object.assign(VIEWS, EXTRA.views); // AF-121..AF-135 screens (admin-extra.js)
Object.assign(ICONS, EXTRA.icons);
let currentView = 'dashboard';
let refreshView = () => {}; // set by each list view so modals can refresh it

/* ---------- sidebar menu ----------
   Every admin function has its own entry. `q` says which query values make an entry the "current" one;
   `kw` are extra words the menu search understands (try "refund", "price", "block", "reschedule"). */
const NAV = [
  { label: 'Dashboard', icon: 'dashboard', route: 'dashboard', perm: 'dashboard', title: 'Admin Dashboard', kw: 'overview statistics revenue totals home summary' },
  { group: 'bookings', label: 'Bookings', icon: 'bookings', children: [
    { label: 'All bookings', route: 'bookings', href: '#/bookings?status=', q: {}, perm: 'bookings', title: 'Booking Management', kw: 'reservations list search filter manage reschedule move change status complete' },
    { label: "Today's bookings", route: 'bookings', href: () => `#/bookings?date=${todayStr()}`, q: { date: '*' }, perm: 'bookings', code: '', title: "Today's bookings", kw: 'today now arrivals' },
    { label: 'Waiting for approval', route: 'bookings', href: '#/bookings?status=pending', q: { status: 'pending' }, perm: 'bookings', badge: true, title: 'Booking Approval', kw: 'approve reject approval pending review' },
    { label: 'Cancelled', route: 'bookings', href: '#/bookings?status=cancelled', q: { status: 'cancelled' }, perm: 'bookings', title: 'Booking Cancellation', kw: 'cancel cancellation reason cancelled' },
  ] },
  { group: 'payments', label: 'Payments', icon: 'payments', children: [
    { label: 'To collect', route: 'payments', href: '#/payments?payment=pending', q: { payment: 'pending' }, perm: 'payments', title: 'Payment Management', kw: 'unpaid pay cash gcash record payment mark paid owed' },
    { label: 'Collected', route: 'payments', href: '#/payments?payment=paid', q: { payment: 'paid' }, perm: 'payments', code: '', title: 'Paid bookings', kw: 'paid revenue received income' },
    { label: 'Verification', route: 'verify', href: '#/verify', q: {}, perm: 'payments', title: 'Payment Verification', kw: 'verify submitted proof reference gcash check reject' },
    { label: 'Refunds', route: 'refunds', href: '#/refunds', q: {}, perm: 'payments', title: 'Refund Management', kw: 'refund refunded return money cancelled' },
    { label: 'Transactions', route: 'transactions', href: '#/transactions', q: {}, perm: 'payments', title: 'Transaction History', kw: 'history payments refunds ledger money log' },
    { label: 'Shift payments', route: 'shiftpay', perm: 'payments', title: 'Payment report for a shift', kw: 'shift report cash drawer count handover collected today end of day method gcash' },
  ] },
  { group: 'schedule', label: 'Schedule', icon: 'schedule', children: [
    { label: 'Court schedule', route: 'schedule', perm: 'schedule.view', title: 'View Court Schedule', kw: 'court schedule slots block unblock maintenance event conflicts calendar availability' },
    { label: 'Daily schedule', route: 'daily', perm: 'schedule.view', title: 'Daily Schedule', kw: 'day list today reservations customers times print daily' },
  ] },
  { label: 'Check-ins', icon: 'checkins', route: 'checkins', perm: 'checkins', title: 'Check-in Management', kw: 'arrive arrival check in check out checkout attendance today' },
  { group: 'courts', label: 'Courts', icon: 'courts', children: [
    { label: 'All courts', route: 'courts', href: '#/courts', q: {}, perm: 'courts.view', title: 'Court Management and Court Information', kw: 'add edit remove delete details name number location description facilities photo information' },
    { label: 'Status', route: 'courts', href: '#/courts?tab=status', q: { tab: 'status' }, perm: 'courts.status', title: 'Court Status Management', kw: 'available unavailable maintenance closed open' },
    { label: 'Pricing', route: 'courts', href: '#/courts?tab=pricing', q: { tab: 'pricing' }, perm: 'courts.pricing', title: 'Court Pricing Management', kw: 'price rate fee cost per hour peso' },
    { label: 'Hours & rules', route: 'settings', href: '#/settings', q: {}, perm: 'settings', title: 'Operating hours, booking rules and cancellation policy', kw: 'hours open close operating booking approval rules facility cancellation policy refund cut-off cutoff advance notice payment methods gcash instructions system settings' },
    { label: 'Court usage', route: 'usage', perm: 'reports.daily', title: 'Court Utilization', kw: 'usage utilization busy occupied hours grid how often used today live' },
    { label: 'Maintenance', route: 'maintenance', perm: 'maintenance.report', title: 'Maintenance Reporting', kw: 'report problem damaged broken repair net lights equipment issue fix maintenance' },
    { label: 'Time slots', route: 'courts', href: '#/courts?tab=slots', q: { tab: 'slots' }, perm: 'courts.manage', title: 'Time Slot Management', kw: 'slot length duration minutes per court' },
  ] },
  { label: 'Location', icon: 'location', route: 'location', perm: 'settings', title: 'Facility location and map', kw: 'map pin address directions where find us gps coordinates latitude longitude openstreetmap google maps waze area' },
  { group: 'people', label: 'People', icon: 'staff', children: [
    { label: 'Customers', route: 'customers', perm: 'users', title: 'User Management', kw: 'users accounts add edit deactivate reactivate' },
    { label: 'Staff', route: 'staff', perm: 'staff', title: 'Staff Management', kw: 'employees accounts add deactivate team' },
    { label: 'Shifts', route: 'shifts', perm: 'shifts', title: 'Staff shifts', kw: 'shift roster schedule work hours duty assign week team' },
    { label: 'Help requests', route: 'helpdesk', perm: 'help', title: 'Help requests from staff', kw: 'help support questions staff ask answer' },
    { label: 'Roles & access', route: 'roles', perm: 'roles', title: 'Role and Access Management', kw: 'roles permissions access admin staff assign' },
  ] },
  { group: 'care', label: 'Customer care', icon: 'care', children: [
    { label: 'Feedback', route: 'feedback', perm: 'feedback.view', title: 'Customer Feedback', kw: 'ratings reviews stars comments' },
    { label: 'Issues', route: 'issues', perm: 'issues', title: 'Complaint and Issue Management', kw: 'complaints problems reports support reply' },
    { label: 'Incidents', route: 'incidents', perm: 'incidents.report', title: 'Incident Reporting', kw: 'incident injury accident dispute fight damage lost found no show safety first aid record report' },
  ] },
  { group: 'comms', label: 'Messaging', icon: 'comms', children: [
    { label: 'Announcements', route: 'board', perm: 'announcements.view', unless: 'announcements', title: 'Announcements and staff instructions', kw: 'news instructions notice board memo rules closure' },
    { label: 'Notifications', route: 'notifications', perm: 'notifications', title: 'Notifications Management', kw: 'send message alert broadcast customers' },
    { label: 'Announcements', route: 'announcements', perm: 'announcements', title: 'Announcements Management', kw: 'news post publish closure event' },
    { label: 'Promotions', route: 'promotions', perm: 'promotions', title: 'Promotions and Discounts', kw: 'discount promo code offer coupon special rate' },
  ] },
  { group: 'insights', label: 'Insights', icon: 'insights', children: [
    { label: 'Daily report', route: 'dayreport', perm: 'reports.daily', title: 'Daily Booking Report', kw: 'day summary reservations today report print export csv arrivals no show' },
    { label: 'Reports', route: 'reports', perm: 'reports', title: 'Reports', kw: 'generate print pdf csv excel export download bookings users courts payments transactions' },
    { label: 'Booking analytics', route: 'analytics', href: '#/analytics?tab=bookings', q: { tab: 'bookings' }, perm: 'analytics', title: 'Booking Analytics', kw: 'trends peak hours popular courts cancellations' },
    { label: 'Revenue analytics', route: 'analytics', href: '#/analytics?tab=revenue', q: { tab: 'revenue' }, perm: 'analytics', title: 'Revenue Analytics', kw: 'income money earnings sales' },
    { label: 'User analytics', route: 'analytics', href: '#/analytics?tab=users', q: { tab: 'users' }, perm: 'analytics', title: 'User Analytics', kw: 'customers signups registered active repeat' },
  ] },
  { label: 'Integrations', icon: 'integrations', route: 'integrations', perm: 'settings', title: 'Integrations and API settings', kw: 'api google sign in calendar turnstile captcha map weather on off switch keys pin otp code two-step 2fa' },
  { group: 'security', label: 'Security', icon: 'logins', children: [
    { label: 'Login security', route: 'logins', perm: 'logins', title: 'Login history and account lockouts', kw: 'login sign in signed who failed password attempts locked lockout unlock ip suspicious brute force' },
    { label: 'Active sessions', route: 'sessions', perm: 'sessions', title: 'Session Management', kw: 'sessions signed in logged in online devices end sign out log out kick force logout terminate' },
    { label: 'Audit logs', route: 'audit', perm: 'audit', title: 'Audit Logs', kw: 'history activity log who changed monitoring security export csv' },
    { label: 'API tokens', route: 'tokens', perm: 'settings', title: 'API tokens for other systems', kw: 'api token key access bearer system app script door panel spreadsheet sheets zapier machine v1' },
  ] },
  { group: 'data', label: 'Data', icon: 'data', children: [
    { label: 'Backup & restore', route: 'backups', perm: 'data', title: 'Backup and Restore', kw: 'backup restore download upload copy save database recover automatic daily' },
    { label: 'Data checks', route: 'datachecks', perm: 'data', title: 'Data Management', kw: 'data check fix records accuracy clean up cleanup old notifications counts integrity' },
  ] },
  { group: 'me', label: 'My account', icon: 'profile', children: [
    { label: 'Profile & password', route: 'profile', perm: 'dashboard', title: 'Profile, password, security PIN and devices', kw: 'profile password change name phone security pin devices sessions sign out' },
    { label: 'My notifications', route: 'alerts', perm: 'dashboard', title: 'My notifications', kw: 'notifications alerts bell inbox unread messages new' },
    { label: 'My shifts', route: 'myshifts', perm: 'shifts.view', unless: 'shifts', title: 'Shift Information', kw: 'shift roster schedule work hours duty when do i work' },
    { label: 'My activity', route: 'activity', perm: 'dashboard', title: 'Activity Log', kw: 'activity history what i did log actions' },
    { label: 'Help & support', route: 'help', perm: 'dashboard', title: 'Help and Support', kw: 'help support how to guide instructions ask admin contact question problem' },
  ] },
];

const NAV_KEY = 'adminNavCollapsed';
let navCollapsed = new Set();
try { navCollapsed = new Set(JSON.parse(localStorage.getItem(NAV_KEY) || '[]')); } catch (e) { /* storage unavailable */ }
const saveCollapsed = () => { try { localStorage.setItem(NAV_KEY, JSON.stringify([...navCollapsed])); } catch (e) { /* ignore */ } };
let leafSpecs = [];
const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const svgIcon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function buildNav() {
  leafSpecs = [];
  const leaf = (spec, cls, groupLabel = '') => {
    const i = leafSpecs.push(spec) - 1;
    const href = typeof spec.href === 'function' ? spec.href() : (spec.href || `#/${spec.route}`);
    const search = `${spec.label} ${groupLabel} ${spec.kw || ''}`.toLowerCase();
    const tip = spec.title || spec.label;
    const badge = spec.badge ? '<span class="pending-badge hidden"></span>' : '';
    return cls === 'nav-item'
      ? `<a class="nav-item" href="${esc(href)}" data-i="${i}" data-search="${esc(search)}" title="${esc(tip)}">${svgIcon(spec.icon)}<span class="label">${esc(spec.label)}</span></a>`
      : `<a class="nav-sub" href="${esc(href)}" data-i="${i}" data-search="${esc(search)}" title="${esc(tip)}"><span class="label">${esc(spec.label)}</span>${badge}</a>`;
  };

  $('#nav').innerHTML = NAV.map((item) => {
    if (item.group) {
      const kids = item.children.filter((c) => can(c.perm) && !(c.unless && can(c.unless)));
      if (!kids.length) return '';
      const collapsed = navCollapsed.has(item.group);
      return `<div class="nav-group${collapsed ? ' collapsed' : ''}" data-group="${item.group}">
        <button type="button" class="nav-parent" aria-expanded="${!collapsed}" aria-controls="grp-${item.group}">
          ${svgIcon(item.icon)}<span class="label">${esc(item.label)}</span>${item.group === 'bookings' ? '<span class="pending-badge hidden"></span>' : ''}${CHEVRON}
        </button>
        <div class="nav-children" id="grp-${item.group}"><div>${kids.map((k) => leaf({ ...k, route: k.route }, 'nav-sub', item.label)).join('')}</div></div>
      </div>`;
    }
    return can(item.perm) && !(item.unless && can(item.unless)) ? leaf(item, 'nav-item') : '';
  }).join('') + '<div class="nav-empty" id="navEmpty" hidden>Nothing in the menu matches that.</div>';
}

function setGroup(grp, open) {
  grp.classList.toggle('collapsed', !open);
  grp.querySelector('.nav-parent').setAttribute('aria-expanded', String(open));
  if (open) navCollapsed.delete(grp.dataset.group); else navCollapsed.add(grp.dataset.group);
  saveCollapsed();
}

/** Marks the menu entry for the current screen (bold white + yellow marker) and opens its group. */
function highlightNav(routeId, params) {
  let best = -1; let bestScore = -1;
  leafSpecs.forEach((s, i) => {
    if (s.route !== routeId) return;
    const keys = Object.keys(s.q || {});
    let score;
    if (keys.length) {
      const ok = keys.every((k) => (s.q[k] === '*' ? !!params.get(k) : params.get(k) === s.q[k]));
      if (!ok) return;
      score = 1 + keys.length;
    } else {
      const filtered = ['status', 'date', 'payment', 'tab', 'q'].some((k) => params.get(k));
      score = filtered ? 0.1 : 0.5;
    }
    if (score > bestScore) { best = i; bestScore = score; }
  });
  if (best < 0) best = leafSpecs.findIndex((s) => s.route === routeId);
  document.querySelectorAll('#nav [aria-current]').forEach((e) => e.removeAttribute('aria-current'));
  document.querySelectorAll('#nav .has-active').forEach((e) => e.classList.remove('has-active'));
  if (best < 0) return;
  const el = $(`#nav [data-i="${best}"]`);
  if (!el) return;
  el.setAttribute('aria-current', 'page');
  const grp = el.closest('.nav-group');
  if (grp) { grp.classList.add('has-active'); if (grp.classList.contains('collapsed')) setGroup(grp, true); }
}

/** Soft fade at the bottom of the menu when there is more to scroll to. */
function updateMore() {
  const m = $('#nav');
  m.classList.toggle('more', m.scrollHeight - m.clientHeight - m.scrollTop > 6);
}

function wireMenu() {
  const nav = $('#nav');
  nav.addEventListener('scroll', updateMore);
  nav.addEventListener('transitionend', updateMore); // groups opening / closing change the height
  window.addEventListener('resize', updateMore);
  setTimeout(updateMore, 50);
  const input = $('#navSearch');
  const side = $('#side');
  const menuBtn = $('#menuBtn');
  const closeMobile = () => { side.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); };

  nav.addEventListener('click', (e) => {
    const parent = e.target.closest('.nav-parent');
    if (parent) { const g = parent.parentElement; setGroup(g, g.classList.contains('collapsed')); return; }
    if (e.target.closest('a')) closeMobile();
  });

  const visibleLinks = () => [...nav.querySelectorAll('a[data-search]')].filter((a) => !a.hidden && !a.closest('[hidden]'));
  const filter = () => {
    const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    nav.classList.toggle('searching', terms.length > 0);
    nav.querySelectorAll('a[data-search]').forEach((a) => { a.hidden = !terms.every((t) => a.dataset.search.includes(t)); });
    nav.querySelectorAll('.nav-group').forEach((g) => { g.hidden = terms.length > 0 && !g.querySelector('a[data-search]:not([hidden])'); });
    $('#navEmpty').hidden = !(terms.length > 0 && !visibleLinks().length);
    updateMore();
  };
  input.addEventListener('input', filter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; filter(); input.blur(); }
    if (e.key === 'Enter') {
      const first = visibleLinks()[0];
      if (first) { location.hash = first.getAttribute('href'); input.value = ''; filter(); input.blur(); closeMobile(); }
    }
    if (e.key === 'ArrowDown') { const first = visibleLinks()[0]; if (first) { e.preventDefault(); first.focus(); } }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      side.classList.add('open'); menuBtn.setAttribute('aria-expanded', 'true');
      input.focus(); input.select();
    }
  });
  menuBtn.addEventListener('click', () => {
    const open = !side.classList.contains('open');
    side.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  });
}

async function updatePendingBadge() {
  const badges = document.querySelectorAll('#nav .pending-badge');
  if (!badges.length || !can('bookings')) return;
  try {
    const r = await api('/bookings?status=pending&limit=1');
    badges.forEach((b) => { b.textContent = r.total; b.classList.toggle('hidden', !r.total); });
  } catch (e) { /* non-critical */ }
}

function setHead(title, subtitle = '', actionsHtml = '') {
  $('#title').textContent = title;
  $('#subtitle').textContent = subtitle;
  $('#headActions').innerHTML = actionsHtml;
  document.title = `${title} - Admin - MAKI's PickleBall Court`;
}

async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, qs] = raw.split('?');
  const id = VIEWS[name] && can(VIEWS[name].perm) ? name : 'dashboard';
  currentView = id;
  const bell = document.getElementById('bellBtn'); // the bell shows where you are on My notifications
  bell.classList.toggle('on', id === 'alerts');
  if (id === 'alerts') bell.setAttribute('aria-current', 'page'); else bell.removeAttribute('aria-current');
  const params = new URLSearchParams(qs || '');
  highlightNav(id, params);
  document.getElementById('side').classList.remove('open');
  document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
  setHead(VIEWS[id].label);
  view.onclick = null; view.onchange = null; view.oninput = null; view.onsubmit = null;
  refreshView = () => {};
  view.innerHTML = '<div class="skeleton" aria-label="Loading"><i></i><i></i><i></i><i></i></div>';
  try {
    await VIEWS[id].render(params);
  } catch (err) {
    view.innerHTML = `<div class="card"><div class="empty">${esc(err.message)}</div></div>`;
  }
}
window.addEventListener('hashchange', route);
$('#logoutBtn').addEventListener('click', () => signOut({ remote: true }));

/* ---------- each screen's state lives in the address ----------
   A list's page, search, filters and tabs are part of the address, e.g. admin.html#/audit?page=5&q=refund.
   Reload or share that address and the same view opens; Back and Forward step through pages and filters
   (the router above redraws the screen from the address when they do). */

/** A screen's state read from the address, with `defaults` for what it leaves out. A number stays a whole number of 1 or more. */
function stateFrom(params, defaults) {
  const out = {};
  Object.entries(defaults).forEach(([k, d]) => {
    const v = params ? params.get(k) : null;
    if (v === null) out[k] = d;
    else if (typeof d === 'number') { const n = parseInt(v, 10); out[k] = Number.isInteger(n) && n >= 1 ? n : d; }
    else out[k] = v;
  });
  return out;
}

/**
 * Writes a screen's state into the address without redrawing the screen. push: a step Back returns to (a page or
 * filter change); otherwise the address is replaced (typing in a search box). Page 1 and empty values are left out
 * unless an empty value is a choice of its own (e.g. "Any payment status" where the default is "Unpaid").
 */
function stateTo(st, defaults, { push = true } = {}) {
  const qs = new URLSearchParams();
  Object.entries(defaults).forEach(([k, d]) => {
    const v = st[k] == null ? '' : st[k];
    if (k === 'page' && Number(v) <= 1) return;
    if (v === '' && d === '') return;
    qs.set(k, String(v));
  });
  const hash = `#/${currentView}${qs.toString() ? `?${qs}` : ''}`;
  if (hash === location.hash) return;
  history[push ? 'pushState' : 'replaceState'](null, '', hash);
  highlightNav(currentView, qs);
}

/**
 * Ties a screen's state object to the address. With `params` (opened from the address) the state is read from it;
 * with null (the screen redraws itself) the state is kept. Returns go(push): call it after changing the state to
 * update the address and reload the list.
 */
function bindState(st, defaults, params) {
  if (params) Object.assign(st, stateFrom(params, defaults));
  return (push = true) => { stateTo(st, defaults, { push }); refreshView(); };
}

/** Counts a number up from 0 so the dashboard feels alive; instant when motion is reduced. */
function countUp(el, to, isPeso) {
  const show = (n) => { el.textContent = isPeso ? peso(n) : String(n); };
  if (reducedMotion() || !to || !window.requestAnimationFrame) return show(to);
  const t0 = performance.now(); const dur = 700;
  show(0);
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    show(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* =====================================================================
   AF-102  Dashboard
   ===================================================================== */
async function renderDashboard() {
  const hour = Number(new Date(Date.now() + MANILA_MS).toISOString().slice(11, 13));
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  setHead(`${hello}, ${state.me.firstName}`, `${state.me.role === 'staff' ? 'Staff dashboard · ' : ''}${fmtLong(todayStr())}`);
  shiftLine(); // SF-134: "Your shift today: 08:00–16:00"
  const { data: d } = await api('/dashboard');
  const max = Math.max(1, ...d.series.map((s) => s.count));
  const today = todayStr();

  // `n` is the raw number so the tile can count up to it; `isPeso` formats it as money
  const tile = (href, cls, k, n, isPeso, s) => {
    const inner = `<div class="k">${k}</div><div class="v num" data-to="${n}"${isPeso ? ' data-peso' : ''}>${isPeso ? peso(n) : n}</div><div class="s">${s}</div>`;
    return href ? `<a href="${href}" class="${cls}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
  };

  view.innerHTML = `
    <div class="card ribbon">
      ${tile(can('bookings') ? '#/bookings?status=pending' : '', d.pendingBookings ? 'urgent' : '', 'Waiting for approval', d.pendingBookings, false, d.pendingBookings ? 'Review these first' : 'Nothing waiting')}
      ${tile(can('schedule.view') ? '#/schedule' : '', '', "Today's bookings", d.todaysBookings, false, 'across all courts')}
      ${d.revenue !== null && d.revenue !== undefined ? `
      ${tile(can('payments') ? '#/payments?payment=paid' : '', '', 'Collected', d.revenue, true, `${d.paidCount} paid booking${d.paidCount === 1 ? '' : 's'}`)}
      ${tile(can('payments') ? '#/payments?payment=pending' : '', d.outstandingCount ? 'urgent' : '', 'Still to collect', d.outstanding, true, `${d.outstandingCount} unpaid booking${d.outstandingCount === 1 ? '' : 's'}`)}`
    : `
      ${tile('', '', 'On court now', d.today ? d.today.checkins.onCourt : 0, false, 'checked in right now')}
      ${tile(can('courts.view') ? '#/courts' : '', '', 'Courts open now', d.today ? d.today.courts.filter((c) => c.openNow).length : 0, false, `of ${d.totalCourts} court${d.totalCourts === 1 ? '' : 's'}`)}`}
    </div>

    ${todayCard(d.today)}

    <div class="card" id="weatherCard" hidden></div>

    <div class="grid2">
      <div class="card">
        <h2>Bookings by day</h2>
        <div class="chart" role="img" aria-label="Bookings per day for the past 6 days and next 7 days">
          ${d.series.map((s, i) => `
            <div class="col ${s.isToday ? 'today' : s.date > today ? 'future' : ''}">
              <div class="n num">${s.count}</div>
              <div class="bar-fill" style="height:${Math.max(2, Math.round((s.count / max) * 100))}px;animation-delay:${i * 35}ms"></div>
              <div class="d">${s.isToday ? 'Today' : esc(fmtShort(s.date))}</div>
            </div>`).join('')}
        </div>
        <div class="legend"><span><i style="background:#a9c8f0"></i>Past</span><span><i style="background:var(--ball);box-shadow:inset 0 0 0 1.5px #072543"></i>Today</span><span><i style="background:var(--brand)"></i>Coming up</span></div>
      </div>
      <div class="card">
        <h2>Facility</h2>
        <ul class="facts">
          <li><span>Courts open for booking</span><b class="num">${d.availableCourts} of ${d.totalCourts}</b></li>
          <li><span>Active bookings, all time</span><b class="num">${d.totalBookings}</b></li>
          ${d.totalCustomers !== null && d.totalCustomers !== undefined ? `<li><span>Customers</span><b class="num">${d.totalCustomers}</b></li>` : ''}
          ${d.totalStaff !== null && d.totalStaff !== undefined ? `<li><span>Staff and admins</span><b class="num">${d.totalStaff}</b></li>` : ''}
          ${d.totalCustomers === null ? `<li><span>Bookings today</span><b class="num">${d.todaysBookings}</b></li><li><span>Waiting for approval</span><b class="num">${d.pendingBookings}</b></li>` : ''}
        </ul>
      </div>
    </div>

    <div class="card">
      <h2>Latest bookings</h2>
      <div class="tablewrap"><table>
        <thead><tr><th>Reference</th><th>Customer</th><th>Court</th><th>Date and time</th><th>Status</th><th>Payment</th></tr></thead>
        <tbody>${d.recent.length ? d.recent.map((b) => `
          <tr class="click" data-id="${esc(b._id)}">
            <td class="num"><b>${esc(b.referenceNumber)}</b></td>
            <td>${esc(custName(b))}</td><td>${esc(b.courtName)}</td>
            <td>${fmtDate(b.date)}<span class="sub num">${esc(b.startTime)}–${esc(b.endTime)}</span></td>
            <td>${pillS(b.status)}</td><td>${pillP(b.paymentStatus)}</td>
          </tr>`).join('') : emptyRow(6, 'No bookings yet. They will show up here as customers book.')}
        </tbody></table></div>
    </div>`;

  view.querySelectorAll('[data-to]').forEach((el) => countUp(el, Number(el.dataset.to), el.hasAttribute('data-peso')));
  renderWeather();
  refreshView = renderDashboard;
  if ($('#dashWalkIn')) $('#dashWalkIn').onclick = () => walkInDialog();
  if ($('#dashVerify')) $('#dashVerify').onclick = () => openQrScanner();
  view.onclick = (e) => {
    const tr = e.target.closest('tr[data-id], li[data-id]');
    if (tr && can('bookings')) openBooking(tr.dataset.id);
  };
}

/* =====================================================================
   AF-115..AF-119  Bookings: list, details, approve/reject, cancel,
                   reschedule, status
   ===================================================================== */
const BK_DEFAULTS = { page: 1, status: '', payment: '', courtId: '', date: '', time: '', q: '' };
// SF-126: a part of the day, or who is playing at an hour
const TIME_FILTERS = [['morning', 'Morning (before 12:00)'], ['afternoon', 'Afternoon (12:00–17:00)'], ['evening', 'Evening (from 17:00)'],
  ...Array.from({ length: 18 }, (_, i) => { const h = String(i + 5).padStart(2, '0'); return [`${h}:00`, `Playing at ${h}:00`]; })];
const bk = { ...BK_DEFAULTS };

function bookingRows(list) {
  if (!list.length) return emptyRow(7, 'No bookings match these filters.');
  return list.map((b) => `
    <tr class="click" data-id="${esc(b._id)}">
      <td class="num"><b>${esc(b.referenceNumber)}</b><span class="sub">made ${esc(fmtDate(b.createdAt))}</span></td>
      <td>${esc(custName(b))}<span class="sub">${esc(b.user ? b.user.email : '')}</span></td>
      <td>${esc(courtOf(b))}</td>
      <td>${fmtDate(b.date)}<span class="sub num">${esc(b.startTime)}–${esc(b.endTime)}</span></td>
      <td class="r num">${peso(b.totalFee)}</td>
      <td>${pillS(b.status)}</td>
      <td>${pillP(b.paymentStatus)}</td>
    </tr>`).join('');
}

function pager(d) {
  return `<div class="pager"><span class="num">${d.total} booking${d.total === 1 ? '' : 's'} &middot; page ${d.page} of ${d.pages}</span>
    <div><button class="btn small" data-page="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>Previous</button>
    <button class="btn small" data-page="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Next</button></div></div>`;
}

async function renderBookings(params) {
  setHead('Bookings', 'Every reservation, newest dates first', `<button class="btn" id="bkCsv" type="button" title="Every booking matching the filters, as a spreadsheet">Export CSV</button>
    ${can('bookings') ? '<button class="btn primary" id="bkWalkIn" type="button">Walk-in booking</button>' : ''}`);
  if ($('#bkWalkIn')) $('#bkWalkIn').onclick = () => walkInDialog();
  $('#bkCsv').onclick = () => {
    const qs = new URLSearchParams({ format: 'csv' });
    ['status', 'payment', 'courtId', 'date', 'time', 'q'].forEach((k) => { if (bk[k]) qs.set(k, bk[k]); });
    downloadFile(`/bookings?${qs}`, 'bookings.csv', $('#bkCsv')).catch((e) => toast(e.message, true));
  };
  const go = bindState(bk, BK_DEFAULTS, params); // #/bookings?status=pending&page=2
  const courts = can('courts.view') ? (await api('/courts')).courts : [];

  view.innerHTML = `
    <div class="bar">
      <input class="grow" id="fQ" type="search" placeholder="Reference, name, mobile, email... (press /)" title="Search by reference, customer or walk-in name, email, mobile, payment reference or a date (2026-11-20)" value="${esc(bk.q)}" aria-label="Search bookings" />
      <select id="fStatus" aria-label="Booking status"><option value="">All statuses</option>${optionList(Object.entries(STATUS_LABEL), bk.status)}</select>
      <select id="fPay" aria-label="Payment status"><option value="">Any payment</option>${optionList(Object.entries(PAY_LABEL), bk.payment)}</select>
      <select id="fCourt" aria-label="Court"><option value="">All courts</option>${optionList(courts.map((c) => [c._id, c.name]), bk.courtId)}</select>
      <input id="fDate" type="date" value="${esc(bk.date)}" aria-label="Date" />
      <select id="fTime" class="narrow" aria-label="Time"><option value="">Any time</option>${optionList(TIME_FILTERS, bk.time)}</select>
      <button class="btn" id="fClear" type="button">Clear</button>
    </div>
    <div class="card" id="listCard"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i><i></i></div></div>`;

  async function load() {
    const qs = new URLSearchParams({ page: bk.page, limit: 15 });
    ['status', 'payment', 'courtId', 'date', 'time', 'q'].forEach((k) => { if (bk[k]) qs.set(k, bk[k]); });
    const d = await api(`/bookings?${qs}`);
    if (d.page > d.pages) { bk.page = d.pages; stateTo(bk, BK_DEFAULTS, { push: false }); return load(); }
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>Reference</th><th>Customer</th><th>Court</th><th>Date and time</th><th class="r">Fee</th><th>Status</th><th>Payment</th></tr></thead>
      <tbody>${bookingRows(d.bookings)}</tbody></table></div>${pager(d)}`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();

  const apply = (push = true) => { bk.page = 1; go(push); };
  const search = debounce(() => { bk.q = $('#fQ').value.trim(); apply(false); });
  view.oninput = (e) => { if (e.target.id === 'fQ') search(); };
  view.onchange = (e) => {
    const map = { fStatus: 'status', fPay: 'payment', fCourt: 'courtId', fDate: 'date', fTime: 'time' };
    if (map[e.target.id]) { bk[map[e.target.id]] = e.target.value; apply(); }
  };
  view.onclick = (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { bk.page = Number(pg.dataset.page); return go(); }
    if (e.target.closest('#fClear')) { Object.assign(bk, BK_DEFAULTS); stateTo(bk, BK_DEFAULTS); return renderBookings(new URLSearchParams()); }
    const tr = e.target.closest('tr[data-id]');
    if (tr) openBooking(tr.dataset.id);
  };
}

/* =====================================================================
   Staff: Today at the facility (dashboard) - courts right now, check-ins,
   what needs attention, today's bookings
   ===================================================================== */
function todayCard(t) {
  if (!t) return '';
  const COURT_STATE = { maintenance: 'Under maintenance', unavailable: 'Not available', closed: 'Closed' };
  const courtLine = (c) => {
    if (c.status !== 'available') return { cls: 'off', text: COURT_STATE[c.status] || c.status };
    if (c.now) return { cls: 'busy', text: `In use until ${c.now.until} &middot; ${esc(c.now.customer)}${c.now.status === 'pending' ? ' (waiting for approval)' : c.now.checkedIn ? ' &middot; checked in' : ''}` };
    if (!c.openNow) return { cls: 'off', text: `Closed now &middot; open ${esc(c.openTime)}–${esc(c.closeTime)}${c.next ? ` &middot; first booking ${esc(c.next.startTime)}` : ''}` };
    if (c.next) return { cls: 'free', text: `Free now &middot; next booking at ${esc(c.next.startTime)}` };
    return { cls: 'free', text: 'Free for the rest of the day' };
  };
  const att = t.attention;
  const need = [
    [can('bookings'), '#/bookings?status=pending', 'Bookings waiting for approval', att.approvals],
    [can('payments'), '#/verify', 'Payments to verify', att.verifications],
    [can('payments'), '#/refunds', 'Refunds to make', att.refunds],
    [can('issues'), '#/issues?status=open', 'Open issues from customers', att.issues],
    [can('maintenance.report') && att.maintenance !== null && att.maintenance !== undefined, '#/maintenance', 'Maintenance reports not fixed yet', att.maintenance],
    [can('incidents') && att.incidents !== null && att.incidents !== undefined, '#/incidents', 'Open incidents', att.incidents],
    [can('help') && att.help !== null && att.help !== undefined, '#/helpdesk', 'Help requests from staff', att.help],
  ].filter(([ok]) => ok);
  const checkin = (b) => (b.checkedOutAt ? 'Finished' : b.checkedInAt ? 'On court' : b.status === 'pending' ? '-' : 'Not arrived');
  return `<div class="card today-card">
    <div class="today-head"><h2>Today at the facility <span class="muted">as of ${esc(t.now)}</span></h2>
      <div class="btnrow">${can('bookings') ? '<button class="btn primary" id="dashWalkIn" type="button">Walk-in booking</button>' : ''}
        ${can('checkins') ? '<button class="btn" id="dashVerify" type="button">Verify booking</button><a class="btn" href="#/checkins">Check-ins</a>' : ''}${can('schedule.view') ? '<a class="btn" href="#/schedule">Schedule</a>' : ''}</div></div>
    <div class="today-grid">
      <div><h3>Courts right now</h3>
        <ul class="court-now">${t.courts.length ? t.courts.map((c) => { const l = courtLine(c); return `<li class="${l.cls}"${c.now && can('bookings') ? ` data-id="${esc(c.now.id)}"` : ''}><b>${esc(c.name)}</b><span>${l.text}</span></li>`; }).join('') : '<li class="off"><span>No courts yet</span></li>'}</ul></div>
      <div><h3>Check-ins today</h3>
        <div class="mini today-mini"><div><span>Still to arrive</span><b class="num">${t.checkins.waiting}</b></div><div><span>On court</span><b class="num">${t.checkins.onCourt}</b></div><div><span>Finished</span><b class="num">${t.checkins.finished}</b></div></div>
        <h3 style="margin-top:14px;">Needs attention</h3>
        <ul class="facts">${need.map(([, href, label, n]) => `<li class="${n ? 'attn' : ''}"><a href="${href}">${label}</a><b class="num">${n}</b></li>`).join('')}</ul></div>
    </div>
    <h3>Today's bookings</h3>
    <div class="tablewrap"><table>
      <thead><tr><th>Time</th><th>Court</th><th>Customer</th><th>Status</th><th>Payment</th><th>Check-in</th></tr></thead>
      <tbody>${t.bookings.length ? t.bookings.map((b) => `<tr class="click" data-id="${esc(b._id)}">
        <td class="num"><b>${esc(b.startTime)}–${esc(b.endTime)}</b></td><td>${esc(b.courtName)}</td>
        <td>${esc(b.customer)}${b.source === 'desk' ? '<span class="sub">at the desk</span>' : ''}</td>
        <td>${pillS(b.status)}</td><td>${pillP(b.paymentStatus)}</td><td class="muted">${checkin(b)}</td></tr>`).join('')
        : emptyRow(6, 'No bookings today yet.')}</tbody></table></div>
  </div>`;
}

/* =====================================================================
   Staff: Create Walk-in Booking - a booking made at the desk for someone
   who comes to the facility. Confirmed at once; the customer booking rules
   don't apply. A guest needs no account.
   ===================================================================== */

async function walkInDialog(prefill = {}) {
  let courts = [];
  try { ({ courts } = await request(`${window.API_ROOT || '/api'}/courts`)); } catch (err) { return toast(err.message, true); }
  if (!courts.length) return toast('There are no courts yet. Add one under Courts first.', true);
  const first = courts.find((c) => c.status === 'available') || courts[0];
  const st = { courtId: courts.some((c) => c._id === prefill.courtId) ? prefill.courtId : first._id, date: prefill.date || todayStr(), customer: null };

  openModal('Walk-in booking', `
    <form id="wiForm">
      <p class="sub" style="margin-top:0;">For a customer at the desk. It is confirmed at once, and the customer booking rules don't apply.</p>
      <div class="row2">
        ${field('Court', `<select name="courtId" id="wiCourt">${optionList(courts.map((c) => [c._id, `${c.name}${c.status !== 'available' ? ` (${c.status})` : ''}`]), st.courtId)}</select>`)}
        ${field('Date', `<input name="date" id="wiDate" type="date" min="${todayStr()}" value="${esc(st.date)}" required />`)}
      </div>
      ${field('Time', '<select name="startTime" id="wiTime" required><option value="">Loading times...</option></select>', '<span id="wiFee"></span>')}
      <fieldset class="wi-who"><legend>Customer</legend>
        <label class="check"><input type="radio" name="who" value="guest" checked /><span><b>Walk-in guest</b>No account needed</span></label>
        <label class="check"><input type="radio" name="who" value="account" /><span><b>Customer with an account</b>They also get the confirmation</span></label>
      </fieldset>
      <div id="wiGuest" class="row2">
        ${field('Name', '<input name="guestName" id="wiName" maxlength="80" autocomplete="off" />')}
        ${field('Mobile (optional)', '<input name="guestPhone" maxlength="20" inputmode="tel" autocomplete="off" />')}
      </div>
      <div id="wiAccount" hidden>
        ${field('Find the customer', '<input id="wiSearch" type="search" autocomplete="off" placeholder="Name, email or mobile" />')}
        <div id="wiResults" class="wi-results" aria-live="polite"></div>
      </div>
      <label class="check"><input type="checkbox" name="paidNow" /><span><b>Paid now at the desk</b>Leave it unticked if they pay later. The receipt opens right after booking.</span></label>
      <div class="msg error hidden" role="alert"></div>
      <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Make booking</button></div>
    </form>`, { wide: true });
  modalBody.onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(); };

  const minutesOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  async function loadTimes() {
    const sel = $('#wiTime');
    const court = courts.find((c) => c._id === $('#wiCourt').value);
    const date = $('#wiDate').value;
    sel.innerHTML = '<option value="">Loading times...</option>';
    $('#wiFee').textContent = court ? `Fee: ${peso(Math.round(court.pricePerHour * court.slotDurationMinutes / 60))}` : '';
    if (!court || !date) return;
    try {
      const d = await request(`${window.API_ROOT || '/api'}/courts/${court._id}/availability?date=${date}`);
      const nowMin = minutesOf(new Date(Date.now() + MANILA_MS).toISOString().slice(11, 16));
      const label = { booked: 'booked', blocked: 'blocked', past: 'over' };
      const opts = d.slots.map((x) => {
        const now = date === todayStr() && x.status === 'past' && minutesOf(x.endTime) > nowMin; // being played right now: still bookable
        const open = x.status === 'available' || now;
        return `<option value="${esc(x.startTime)}" ${open ? '' : 'disabled'}>${esc(x.startTime)}–${esc(x.endTime)}${now ? ' (now)' : open ? '' : ` (${label[x.status] || x.status})`}</option>`;
      });
      sel.innerHTML = d.courtStatus !== 'available' ? `<option value="">This court is ${esc(d.courtStatus)}</option>`
        : opts.length ? opts.join('') : '<option value="">No times on this day</option>';
      const want = [...sel.options].find((o) => o.value === prefill.startTime && !o.disabled);
      const firstOpen = [...sel.options].find((o) => o.value && !o.disabled);
      sel.value = (want || firstOpen || sel.options[0]).value;
      prefill.startTime = '';
    } catch (err) { sel.innerHTML = `<option value="">${esc(err.message)}</option>`; }
  }
  $('#wiCourt').onchange = loadTimes;
  $('#wiDate').onchange = loadTimes;
  loadTimes();

  // guest or account
  const whoNow = () => (modalBody.querySelector('input[name=who]:checked') || {}).value;
  modalBody.onchange = (e) => {
    if (e.target.name !== 'who') return;
    $('#wiGuest').hidden = whoNow() !== 'guest';
    $('#wiAccount').hidden = whoNow() !== 'account';
    (whoNow() === 'guest' ? $('#wiName') : $('#wiSearch')).focus();
  };
  const showPicked = () => {
    $('#wiResults').innerHTML = st.customer ? `<div class="wi-picked"><span><b>${esc(st.customer.name)}</b> <span class="muted">${esc(st.customer.email)}${st.customer.phone ? ` &middot; ${esc(st.customer.phone)}` : ''}</span></span><button type="button" class="btn small" id="wiChange">Change</button></div>` : '';
  };
  const search = debounce(async () => {
    const q = $('#wiSearch').value.trim();
    if (q.length < 2) { $('#wiResults').innerHTML = ''; return; }
    try {
      const { customers } = await api(`/walk-in/customers?q=${encodeURIComponent(q)}`);
      $('#wiResults').innerHTML = customers.length ? customers.map((c) => `<button type="button" class="wi-pick" data-pick="${esc(c.id)}"><b>${esc(c.name)}</b> <span class="muted">${esc(c.email)}${c.phone ? ` &middot; ${esc(c.phone)}` : ''}</span></button>`).join('')
        : '<p class="muted">No customer matches. Book them as a walk-in guest instead.</p>';
      $('#wiResults').onclick = (e) => {
        if (e.target.closest('#wiChange')) { st.customer = null; showPicked(); $('#wiSearch').hidden = false; $('#wiSearch').focus(); return; }
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        st.customer = customers.find((c) => String(c.id) === b.dataset.pick);
        $('#wiSearch').hidden = true;
        showPicked();
      };
    } catch (err) { $('#wiResults').innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  });
  $('#wiSearch').oninput = search;

  onSubmit($('#wiForm'), async (d) => {
    if (!d.startTime) throw new Error('Choose a free time.');
    const body = { courtId: d.courtId, date: d.date, startTime: d.startTime, paid: Boolean(d.paidNow) };
    if (whoNow() === 'account') {
      if (!st.customer) throw new Error('Find and choose the customer, or book them as a walk-in guest.');
      body.customerId = st.customer.id;
    } else {
      body.walkIn = { name: String(d.guestName || '').trim(), phone: String(d.guestPhone || '').trim() };
      if (body.walkIn.name.length < 2) throw new Error("Enter the walk-in customer's name.");
    }
    const r = await api('/bookings', { method: 'POST', body });
    closeModal();
    toast(`Booked: ${r.booking.referenceNumber}, ${r.booking.courtName} ${r.booking.startTime}–${r.booking.endTime}${r.booking.paymentStatus === 'paid' ? ', paid' : ''}`);
    refreshView();
    if (r.booking.paymentStatus === 'paid' && r.booking.totalFee > 0) openReceipt(r.booking._id); // SF-119
  });
}

async function openBooking(id) {
  try {
    const { booking } = await api(`/bookings/${id}`);
    showBooking(booking);
  } catch (err) { toast(err.message, true); }
}

function changed() { refreshView(); updatePendingBadge(); }

function showBooking(b) {
  const st = b.status;
  const canB = can('bookings');
  const canP = can('payments');

  let actions = '';
  if (canB) {
    if (st === 'pending') actions += '<button class="btn primary" data-act="set" data-status="confirmed">Approve booking</button><button class="btn danger" data-act="ask" data-status="rejected">Reject...</button>';
    if (st === 'confirmed') actions += '<button class="btn primary" data-act="set" data-status="completed">Mark completed</button>';
    if (['pending', 'confirmed'].includes(st)) actions += '<button class="btn" data-act="resched">Reschedule...</button><button class="btn" data-act="assign">Assign court...</button><button class="btn danger" data-act="ask" data-status="cancelled">Cancel booking...</button>';
    if (['cancelled', 'rejected'].includes(st)) actions += '<button class="btn" data-act="set" data-status="confirmed">Reinstate booking</button>';
    if (st === 'completed') actions += '<button class="btn" data-act="set" data-status="confirmed">Reopen as confirmed</button>';
  }
  if (can('incidents.report')) actions += '<button class="btn" data-act="incident">Record an incident...</button>'; // SF-130

  // SF-112 / SF-114 / SF-115: check in and out on the booking's day
  let ciActions = '';
  if (can('checkins') && ['confirmed', 'completed'].includes(st) && toDateStr(b.date) === todayStr()) {
    if (!b.checkedInAt) ciActions = '<button class="btn primary" data-act="checkin" data-ci="in">Check in</button>';
    else if (!b.checkedOutAt) ciActions = '<button class="btn primary" data-act="checkin" data-ci="out">Check out</button><button class="btn" data-act="checkin" data-ci="undo">Undo check-in</button>';
  }

  let payActions = '';
  if (canP) {
    const ps = b.paymentStatus;
    if (['paid', 'refunded'].includes(ps)) payActions += '<button class="btn small" data-act="receipt">Receipt</button>'; // SF-119
    if (['pending', 'failed'].includes(ps) && !['cancelled', 'rejected'].includes(st)) payActions += '<button class="btn primary small" data-act="pay" data-pay="paid">Mark paid</button>';
    if (ps === 'pending') payActions += '<button class="btn small" data-act="pay" data-pay="failed">Mark payment failed</button>';
    if (ps === 'paid') payActions += '<button class="btn small danger" data-act="pay" data-pay="refunded">Refund</button>';
    if (['paid', 'failed', 'refunded'].includes(ps)) payActions += '<button class="btn small" data-act="pay" data-pay="pending">Reset to unpaid</button>';
  }

  openModal(`Booking ${b.referenceNumber}`, `
    <dl class="kv">
      <dt>Customer</dt><dd>${esc(custName(b))}${b.user ? `<span class="sub muted"><br>${esc(b.user.email)}${b.user.phone ? ' &middot; ' + esc(b.user.phone) : ''}</span>`
        : b.walkIn && b.walkIn.phone ? `<span class="sub muted"><br>${esc(b.walkIn.phone)}</span>` : ''}${b.source === 'desk' ? '<span class="sub muted"><br>Booked at the desk (walk-in)</span>' : ''}</dd>
      ${b.user && canB ? '<dt></dt><dd><button type="button" class="btn small" data-act="history">Their bookings and contact</button></dd>' : ''}
      <dt>Court</dt><dd>${esc(courtOf(b))}${b.court && b.court.location ? `<span class="muted"> &middot; ${esc(b.court.location)}</span>` : ''}</dd>
      <dt>Date and time</dt><dd class="num">${fmtDate(b.date)}, ${esc(b.startTime)}–${esc(b.endTime)}</dd>
      <dt>Fee</dt><dd class="num">${peso(b.totalFee)}</dd>
      <dt>Booking status</dt><dd>${pillS(st)}${b.statusReason ? `<div class="muted" style="margin-top:4px;">Reason: ${esc(b.statusReason)}</div>` : ''}</dd>
      <dt>Payment</dt><dd>${pillP(b.paymentStatus)}${b.paidAt ? `<span class="muted"> on ${esc(fmtStamp(b.paidAt))}</span>` : ''}</dd>
      ${b.promoCode ? `<dt>Promo</dt><dd>${esc(b.promoCode)} <span class="muted">(−${peso(b.discount)})</span></dd>` : ''}
      ${b.paymentReference ? `<dt>Payment ref</dt><dd class="num">${esc(b.paymentReference)}${b.paymentStatus === 'pending' ? ' <span class="muted">awaiting verification</span>' : ''}${b.paymentNote ? `<div class="muted">Rejected: ${esc(b.paymentNote)}</div>` : ''}</dd>` : ''}
      ${b.refund && b.refund.at ? `<dt>Refund</dt><dd class="num">${peso(b.refund.amount)} <span class="muted">${esc(b.refund.reason || '')}</span></dd>` : ''}
      ${b.checkedInAt ? `<dt>Check-in</dt><dd>${esc(fmtStamp(b.checkedInAt))}${b.checkedOutAt ? ` <span class="muted">left ${esc(fmtStamp(b.checkedOutAt))}</span>` : ''}</dd>` : ''}
      <dt>Booked on</dt><dd>${esc(fmtStamp(b.createdAt))}</dd>
    </dl>

    ${actions ? `<div class="section"><h3>Booking</h3><div class="btnrow">${actions}</div></div>` : ''}
    ${ciActions ? `<div class="section"><h3>Check-in</h3><div class="btnrow">${ciActions}</div></div>` : ''}

    <div id="reasonBox" class="section hidden">
      <label class="f"><span id="reasonLabel">Reason</span>
        <textarea id="reason" maxlength="300" placeholder="The customer will see this in their notifications"></textarea></label>
      <div class="dlg-foot"><button class="btn" data-act="closebox" type="button">Back</button><button class="btn solid-danger" data-act="reasonGo" type="button" id="reasonGo">Confirm</button></div>
    </div>

    <div id="reschedBox" class="section hidden">
      <h3>Move this booking</h3>
      <label class="f">Court<select id="rsCourt"></select></label>
      <div class="row2">
        <label class="f">Date<input type="date" id="rsDate" min="${todayStr()}" value="${toDateStr(b.date)}" /></label>
        <label class="f">Start time<select id="rsTime"></select></label>
      </div>
      <small class="muted" id="rsHint">Only open slots are listed. The customer is notified of the change.</small>
      <div class="dlg-foot"><button class="btn" data-act="closebox" type="button">Back</button><button class="btn primary" data-act="reschedGo" type="button">Move booking</button></div>
    </div>

    ${payActions ? `<div class="section"><h3>Payment</h3>
      <div class="payrow">
        <div class="btnrow">${payActions}</div></div></div>` : ''}

    <div id="bkErr" class="msg error hidden" role="alert"></div>`);

  const err = (t) => showErr($('#bkErr'), t);
  const hide = (id) => $(id).classList.add('hidden');
  const send = async (path, body, okText) => {
    $('#bkErr').className = 'msg error hidden';
    try {
      const r = await api(`/bookings/${b._id}${path}`, { method: 'PATCH', body, version: b.writeTS });
      toast(okText);
      changed();
      if (path === '/status') closeModal(); else showBooking(r.booking);
      return r;
    } catch (ex) {
      if (ex.code === 'WRITE_CONFLICT') {
        // show the booking as it is now, with the explanation on top
        try { const fresh = await api(`/bookings/${b._id}`); showBooking(fresh.booking); } catch (e) { /* keep old view */ }
        showErr($('#bkErr'), ex.message);
        return null;
      }
      err(ex.message); return null;
    }
  };

  let pendingStatus = null;
  modalBody.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'set') {
      const labels = { confirmed: 'Booking confirmed', completed: 'Marked as completed' };
      send('/status', { status: btn.dataset.status }, labels[btn.dataset.status] || 'Status updated');
    } else if (act === 'ask') {
      pendingStatus = btn.dataset.status;
      $('#reasonLabel').textContent = pendingStatus === 'rejected' ? 'Why is this booking being rejected?' : 'Why is this booking being cancelled?';
      $('#reasonGo').textContent = pendingStatus === 'rejected' ? 'Reject booking' : 'Cancel booking';
      hide('#reschedBox');
      $('#reasonBox').classList.remove('hidden');
      $('#reason').focus();
    } else if (act === 'reasonGo') {
      const reason = $('#reason').value.trim();
      if (!reason) return err('Please enter a reason.');
      send('/status', { status: pendingStatus, reason }, pendingStatus === 'rejected' ? 'Booking rejected' : 'Booking cancelled');
    } else if (act === 'incident') { // SF-130
      incidentDialog(b);
    } else if (act === 'assign') { // SF-123
      assignCourtDialog(b);
    } else if (act === 'history') { // SF-116
      openHistory(b.user._id || b.user.id);
    } else if (act === 'receipt') { // SF-119
      openReceipt(b._id);
    } else if (act === 'checkin') { // SF-114 / SF-115
      send('/checkin', { action: btn.dataset.ci }, { in: 'Checked in', out: 'Checked out', undo: 'Check-in undone' }[btn.dataset.ci]);
    } else if (act === 'closebox') {
      hide('#reasonBox'); hide('#reschedBox');
    } else if (act === 'resched') {
      hide('#reasonBox');
      $('#reschedBox').classList.remove('hidden');
      if (!$('#rsCourt').options.length) {
        const { courts } = await api('/courts').catch(() => ({ courts: [] }));
        $('#rsCourt').innerHTML = optionList(courts.filter((c) => c.status === 'available' || c._id === (b.court && b.court._id)).map((c) => [c._id, `${c.name} (${peso(c.pricePerHour)}/hr)`]), b.court && b.court._id);
      }
      loadSlots(b);
    } else if (act === 'reschedGo') {
      const time = $('#rsTime').value;
      if (!time) return err('Pick an open time slot.');
      const r = await send('/reschedule', { courtId: $('#rsCourt').value, date: $('#rsDate').value, startTime: time }, 'Booking moved');
      if (r && r.feeChanged) toast(`Moved. The fee changed to ${peso(r.booking.totalFee)}${r.booking.paymentStatus === 'paid' ? ' - check the payment' : ''}.`);
    } else if (act === 'pay') {
      const to = btn.dataset.pay;
      const body = { paymentStatus: to };
      const labels = { paid: 'Payment recorded', refunded: 'Marked as refunded', failed: 'Marked as failed', pending: 'Reset to unpaid' };
      send('/payment', body, labels[to]);
    }
  };
  modalBody.onchange = (e) => { if (e.target.id === 'rsCourt' || e.target.id === 'rsDate') loadSlots(b); };
}

async function loadSlots(b) {
  const courtId = $('#rsCourt').value;
  const date = $('#rsDate').value;
  const sel = $('#rsTime');
  if (!courtId || !date) { sel.innerHTML = ''; return; }
  try {
    const r = await api(`/schedule?courtId=${courtId}&date=${date}`);
    const open = r.slots.filter((s) => s.status === 'available' || (s.booking && s.booking.id === b._id));
    sel.innerHTML = open.length
      ? open.map((s) => `<option value="${esc(s.startTime)}">${esc(s.startTime)}–${esc(s.endTime)}${s.booking ? ' (current)' : ''}</option>`).join('')
      : '<option value="">No open slots</option>';
    $('#rsHint').textContent = r.court.status !== 'available'
      ? `${r.court.name} is currently ${r.court.status === 'maintenance' ? 'under maintenance' : r.court.status}, so it can't take bookings.`
      : 'Only open slots are listed. The customer is notified of the change.';
  } catch (ex) { showErr($('#bkErr'), ex.message); }
}

/* =====================================================================
   AF-120  Payments
   ===================================================================== */
const PAY_DEFAULTS = { page: 1, payment: 'pending', q: '' };
const pay = { ...PAY_DEFAULTS };

async function renderPayments(params) {
  setHead('Payments', 'Confirm what customers have paid at the facility');
  const go = bindState(pay, PAY_DEFAULTS, params); // #/payments?payment=paid&page=2
  const { summary: s } = await api('/payments/summary');

  // staff see how many were paid or refunded, not the amounts (s[key].amount is null)
  const stat = (label, key, sub) => `<a href="#/payments?payment=${key}"><div class="k">${label}</div><div class="v num">${s[key].amount === null ? s[key].count : peso(s[key].amount)}</div><div class="s">${s[key].amount === null ? `booking${s[key].count === 1 ? '' : 's'} ${sub}` : `${s[key].count} ${sub}`}</div></a>`;
  view.innerHTML = `
    <div class="card ribbon">
      ${stat('Collected', 'paid', 'paid')}
      ${stat('Still to collect', 'pending', 'unpaid')}
      ${stat('Failed', 'failed', 'failed')}
      ${stat('Refunded', 'refunded', 'refunded')}
    </div>
    <div class="bar">
      <input class="grow" id="pQ" type="search" placeholder="Search reference, customer name or email (press /)" value="${esc(pay.q)}" aria-label="Search payments" />
      <select id="pStatus" aria-label="Payment status"><option value="">Any payment status</option>${optionList(Object.entries(PAY_LABEL), pay.payment)}</select>
    </div>
    <div class="card" id="listCard"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i><i></i></div></div>`;

  let rows = [];
  async function load() {
    const qs = new URLSearchParams({ page: pay.page, limit: 15 });
    if (pay.payment) qs.set('payment', pay.payment);
    if (pay.q) qs.set('q', pay.q);
    const d = await api(`/bookings?${qs}`);
    if (d.page > d.pages) { pay.page = d.pages; stateTo(pay, PAY_DEFAULTS, { push: false }); return load(); }
    rows = d.bookings;
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>Reference</th><th>Customer</th><th>Booking</th><th class="r">Amount</th><th>Payment</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map((b) => {
        const dead = ['cancelled', 'rejected'].includes(b.status);
        const btns = [];
        if (['pending', 'failed'].includes(b.paymentStatus) && !dead) btns.push(`<button class="btn small primary" data-act="markpaid" data-id="${esc(b._id)}">Mark paid</button>`);
        if (b.paymentStatus === 'paid') btns.push(`<button class="btn small danger" data-act="refund" data-id="${esc(b._id)}">Refund</button>`);
        return `<tr class="click" data-id="${esc(b._id)}">
          <td class="num"><b>${esc(b.referenceNumber)}</b></td>
          <td>${esc(custName(b))}<span class="sub">${esc(b.user ? b.user.email : '')}</span></td>
          <td>${esc(courtOf(b))}<span class="sub">${fmtDate(b.date)}, ${esc(b.startTime)} &middot; ${pillS(b.status)}</span></td>
          <td class="r num">${peso(b.totalFee)}</td>
          <td>${pillP(b.paymentStatus)}</td>
          <td class="r">${btns.join(' ')}</td></tr>`;
      }).join('') : emptyRow(6, 'No payments match. Try another status.')}</tbody></table></div>${pager(d)}`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();

  const search = debounce(() => { pay.q = $('#pQ').value.trim(); pay.page = 1; go(false); });
  view.oninput = (e) => { if (e.target.id === 'pQ') search(); };
  view.onchange = (e) => { if (e.target.id === 'pStatus') { pay.payment = e.target.value; pay.page = 1; go(); } };
  view.onclick = (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { pay.page = Number(pg.dataset.page); return go(); }
    const act = e.target.closest('[data-act]');
    if (act) return quickPay(act.dataset.act, rows.find((r) => r._id === act.dataset.id));
    const tr = e.target.closest('tr[data-id]');
    if (tr) openBooking(tr.dataset.id);
  };
}

function quickPay(kind, b) {
  if (!b) return;
  const refund = kind === 'refund';
  openModal(refund ? 'Refund payment' : 'Record payment', `
    <form id="payForm">
      <p>${refund ? 'Mark' : 'Record'} <b class="num">${peso(b.totalFee)}</b> ${refund ? 'as refunded for' : 'as paid for'} booking <b class="num">${esc(b.referenceNumber)}</b> (${esc(custName(b))}).</p>
      <div class="dlg-foot"><button type="button" class="btn" id="payCancel">Cancel</button><button type="submit" class="btn ${refund ? 'solid-danger' : 'primary'}">${refund ? 'Mark refunded' : 'Record payment'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#payCancel').onclick = closeModal;
  onSubmit($('#payForm'), async (data) => {
    await api(`/bookings/${b._id}/payment`, { method: 'PATCH', body: { paymentStatus: refund ? 'refunded' : 'paid' }, version: b.writeTS });
    toast(refund ? 'Marked as refunded' : 'Payment recorded');
    closeModal();
    // summary tiles changed too, so redraw the whole view (same page and filters)
    renderPayments(null);
    updatePendingBadge();
  });
}

/* =====================================================================
   AF-113 / AF-114  Schedule: slot board, block and unblock slots
   ===================================================================== */
const SCHED_DEFAULTS = { courtId: '', date: '' };
const sched = { ...SCHED_DEFAULTS };

async function renderSchedule(params) {
  const save = bindState(sched, SCHED_DEFAULTS, params); // #/schedule?courtId=...&date=2026-11-20
  const { courts } = await api('/courts');
  if (!courts.length) {
    setHead('Schedule', 'Court availability by day');
    view.innerHTML = '<div class="card"><div class="empty">There are no courts yet. Add one under Courts first.</div></div>';
    return;
  }
  if (!courts.some((c) => c._id === sched.courtId)) sched.courtId = courts[0]._id;
  if (!sched.date) sched.date = todayStr();
  setHead('Schedule', can('schedule') ? 'Block slots for maintenance or events; open ones stay bookable'
    : `Court availability by day${can('bookings') ? '. Click an open slot to book a walk-in.' : ''}`);

  view.innerHTML = `
    <div class="bar">
      <select id="sCourt" aria-label="Court">${optionList(courts.map((c) => [c._id, `${c.name}${c.status !== 'available' ? ` (${c.status})` : ''}`]), sched.courtId)}</select>
      <button class="btn" id="sPrev" type="button" aria-label="Previous day">&larr;</button>
      <input type="date" id="sDate" value="${esc(sched.date)}" aria-label="Date" />
      <button class="btn" id="sNext" type="button" aria-label="Next day">&rarr;</button>
      <button class="btn" id="sToday" type="button">Today</button>
      <span style="flex:1"></span>
      ${can('schedule') ? '<button class="btn danger" id="sBlockDay" type="button">Block the whole day</button>' : ''}
    </div>
    <div class="card"><div id="board"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i><i></i></div></div>
      <div class="key"><span>Dashed: open</span><span>Green: booked</span><span>Amber: waiting for approval</span><span>Striped: blocked</span><span>Grey: already passed</span></div></div>`;

  let data = null;
  async function load() {
    data = await api(`/schedule?courtId=${sched.courtId}&date=${sched.date}`);
    const note = data.court.status !== 'available'
      ? `<div class="msg note" style="margin:14px 14px 0;">${esc(data.court.name)} is ${esc(data.court.status)}, so customers can't book it right now.</div>` : '';
    $('#board').innerHTML = `${note}<div class="board">${data.slots.map((s, i) => {
      let line = 'Open'; let cls = '';
      if (s.status === 'booked') { line = `${s.booking.customer}`; cls = ` booked ${s.booking.status === 'pending' ? 'pending' : ''}`; }
      if (s.status === 'blocked') { line = `Blocked${s.reason ? ': ' + s.reason : ''}`; cls = ' blocked'; }
      if (s.status === 'past') { line = 'Passed'; cls = ' past'; }
      return `<button class="slot${cls}" data-i="${i}" ${s.status === 'past' ? 'disabled' : ''}><b>${esc(s.startTime)}–${esc(s.endTime)}</b><span>${esc(line)}</span>${s.booking ? `<span class="num">${esc(s.booking.referenceNumber)}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();

  const go = (date) => { sched.date = date; $('#sDate').value = date; save(); };
  view.onchange = (e) => {
    if (e.target.id === 'sCourt') { sched.courtId = e.target.value; save(); }
    if (e.target.id === 'sDate' && e.target.value) go(e.target.value);
  };
  view.onclick = (e) => {
    if (e.target.closest('#sPrev')) return go(addDays(sched.date, -1));
    if (e.target.closest('#sNext')) return go(addDays(sched.date, 1));
    if (e.target.closest('#sToday')) return go(todayStr());
    if (e.target.closest('#sBlockDay')) return blockDialog(data, null);
    const slotEl = e.target.closest('.slot');
    if (!slotEl || !data) return;
    const s = data.slots[Number(slotEl.dataset.i)];
    if (s.status === 'booked') { if (can('bookings')) openBooking(s.booking.id); }
    else if (s.status === 'blocked') { if (can('schedule')) unblockDialog(s); else toast(`Blocked by the facility${s.reason ? `: ${s.reason}` : ''}`); }
    else if (s.status === 'available') {
      if (can('schedule')) blockDialog(data, s);
      else if (can('bookings')) walkInDialog({ courtId: sched.courtId, date: sched.date, startTime: s.startTime });
    }
  };
}

function blockDialog(data, slot) {
  const allDay = !slot;
  openModal(allDay ? 'Block the whole day' : 'Block this slot', `
    <form id="blockForm">
      <p>${allDay
        ? `Customers won't be able to book any open slot on <b>${esc(data.court.name)}</b> on <b>${esc(fmtLong(data.date))}</b>. Existing bookings are not touched.`
        : `Customers won't be able to book <b class="num">${esc(slot.startTime)}–${esc(slot.endTime)}</b> on <b>${esc(data.court.name)}</b>, ${esc(fmtLong(data.date))}.`}</p>
      ${field('Reason (optional)', '<input name="reason" maxlength="80" placeholder="e.g. Resurfacing, tournament, private event" />')}
      <div class="dlg-foot">${!allDay && can('bookings') ? '<button type="button" class="btn foot-left" id="blkWalkIn">Book it for a walk-in instead</button>' : ''}<button type="button" class="btn" id="blkCancel">Cancel</button><button type="submit" class="btn primary">${allDay ? 'Block all open slots' : 'Block slot'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#blkCancel').onclick = closeModal;
  if ($('#blkWalkIn')) $('#blkWalkIn').onclick = () => walkInDialog({ courtId: sched.courtId, date: sched.date, startTime: slot.startTime });
  onSubmit($('#blockForm'), async (f) => {
    const r = await api('/blocks', { method: 'POST', body: { courtId: sched.courtId, date: sched.date, startTime: slot && slot.startTime, allDay, reason: f.reason } });
    toast(allDay ? `Blocked ${r.blocked} slot${r.blocked === 1 ? '' : 's'}${r.skippedBooked ? `, left ${r.skippedBooked} booked one${r.skippedBooked === 1 ? '' : 's'} alone` : ''}` : 'Slot blocked');
    closeModal();
    refreshView();
  });
}

function unblockDialog(s) {
  openModal('Open this slot again', `
    <form id="unblockForm">
      <p><b class="num">${esc(s.startTime)}–${esc(s.endTime)}</b> is blocked${s.reason ? ` (${esc(s.reason)})` : ''}. Opening it lets customers book it again.</p>
      <div class="dlg-foot"><button type="button" class="btn" id="ubCancel">Keep blocked</button><button type="submit" class="btn primary">Open slot</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#ubCancel').onclick = closeModal;
  onSubmit($('#unblockForm'), async () => {
    await api(`/blocks/${s.blockId}`, { method: 'DELETE' });
    toast('Slot is open again');
    closeModal();
    refreshView();
  });
}

/* =====================================================================
   AF-108 .. AF-111  Courts: add, edit details, status, pricing, remove
   ===================================================================== */
async function renderCourts(params) {
  const allowed = { all: can('courts.view'), status: can('courts.status'), pricing: can('courts.pricing'), slots: can('courts.manage') };
  let tab = (params && params.get('tab')) || 'all';
  if (!allowed[tab]) tab = 'all';
  const INFO = {
    all: ['Courts', 'Details, photos and facilities'],
    status: ['Court status', 'Decide which courts customers can book'],
    pricing: ['Court pricing', 'Price per hour. Bookings already made keep their fee'],
    slots: ['Time slots', 'Opening hours and slot length for each court'],
  };
  setHead(INFO[tab][0], INFO[tab][1], `${can('maintenance.report') ? '<button class="btn" id="reportProblem" type="button">Report a problem</button>' : ''}${tab === 'all' && can('courts.manage') ? '<button class="btn primary" id="addCourt" type="button">Add court</button>' : ''}`);
  if (tab === 'all' && can('courts.manage')) $('#addCourt').onclick = () => courtForm(null);
  if ($('#reportProblem')) $('#reportProblem').onclick = () => reportProblemDialog();
  // SF-121: a court being played on right now
  const busyNow = (c) => (c.inUseNow ? `<span class="sub occupied">Occupied until ${esc(c.inUseNow.until)} &middot; ${esc(c.inUseNow.customer)}</span>` : '');

  const tabLinks = [['all', 'All courts'], ['status', 'Status'], ['pricing', 'Pricing'], ['slots', 'Time slots']].filter(([k]) => allowed[k]);
  view.innerHTML = `${tabLinks.length > 1 ? `<div class="tabs" role="tablist">${tabLinks.map(([k, l]) => `<a role="tab" href="#/courts${k === 'all' ? '' : '?tab=' + k}" aria-selected="${k === tab}">${l}</a>`).join('')}</div>` : ''}
    <div class="card"><div id="courtTable"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i><i></i></div></div></div>`;

  let courts = [];
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const slotCount = (open, close, step) => (open && close && step >= 15 && mins(close) > mins(open) ? Math.floor((mins(close) - mins(open)) / step) : 0);
  const name = (c) => `<b>${esc(c.name)}</b><span class="sub">${esc(c.location)}</span>`;

  const tables = {
    all: () => `<div class="tablewrap"><table>
      <thead><tr><th>Court</th><th>Location</th><th class="r">Price / hour</th><th>Hours and slots</th><th>Status</th><th class="r">Upcoming</th><th></th></tr></thead>
      <tbody>${courts.length ? courts.map((c) => `
        <tr>
          <td><div class="court-cell"><img class="court-thumb" src="${esc(courtPhoto(c))}" alt="" loading="lazy" /><div><b>${esc(c.name)}</b><span class="sub">${esc(c.courtNumber || '')}${c.facilities && c.facilities.length ? (c.courtNumber ? ' &middot; ' : '') + esc(c.facilities.join(', ')) : ''}</span></div></div></td>
          <td>${esc(c.location)}</td>
          <td class="r num">${peso(c.pricePerHour)}</td>
          <td class="num">${esc(c.openTime)}–${esc(c.closeTime)}<span class="sub">${c.slotDurationMinutes}-minute slots</span></td>
          <td>${can('courts.status') ? `<select data-act="status" data-id="${esc(c._id)}" aria-label="Status of ${esc(c.name)}">${optionList(['available', 'unavailable', 'maintenance', 'closed'].map((s) => [s, s]), c.status)}</select>` : pillC(c.status)}${busyNow(c)}</td>
          <td class="r num">${c.upcomingBookings}</td>
          <td class="r"><div class="btnrow" style="justify-content:flex-end;">
            ${can('courts.manage') ? `<button class="btn small" data-act="edit" data-id="${esc(c._id)}">Edit</button>` : ''}
            ${can('courts.pricing') ? `<button class="btn small" data-act="price" data-id="${esc(c._id)}">Price</button>` : ''}
            ${can('courts.manage') ? `<button class="btn small danger" data-act="remove" data-id="${esc(c._id)}">Remove</button>` : ''}
          </div></td>
        </tr>`).join('') : emptyRow(7, 'No courts yet. Add your first court to start taking bookings.')}</tbody></table></div>`,

    status: () => `<div class="tablewrap"><table>
      <thead><tr><th>Court</th><th>Right now</th><th>Change to</th><th class="r">Upcoming bookings</th></tr></thead>
      <tbody>${courts.length ? courts.map((c) => `<tr>
        <td>${name(c)}</td><td>${pillC(c.status)}${busyNow(c)}</td>
        <td><select data-act="status" data-id="${esc(c._id)}" aria-label="Status of ${esc(c.name)}">${optionList(['available', 'unavailable', 'maintenance', 'closed'].map((s) => [s, s]), c.status)}</select></td>
        <td class="r num">${c.upcomingBookings}</td></tr>`).join('') : emptyRow(4, 'No courts yet.')}</tbody></table></div>
      <div class="pad note">Customers can only book courts marked <b>available</b>. Setting a court to maintenance or closed keeps its existing bookings, so review them under Bookings (Assign court moves a customer to a free court).
        "Occupied" shows by itself while a booking is being played. Found something broken? Use <b>Report a problem</b>.</div>`,

    pricing: () => `<div class="tablewrap"><table>
      <thead><tr><th>Court</th><th class="r">Price per hour (₱)</th><th>What a customer pays per slot</th><th></th></tr></thead>
      <tbody>${courts.length ? courts.map((c) => `<tr data-row="${esc(c._id)}">
        <td>${name(c)}</td>
        <td class="r"><input class="inline-input num-in" name="price" type="number" min="0" step="1" value="${esc(c.pricePerHour)}" aria-label="Price per hour for ${esc(c.name)}" /></td>
        <td class="num per-slot">${peso(Math.round(c.pricePerHour * c.slotDurationMinutes / 60))} per ${c.slotDurationMinutes}-min slot</td>
        <td class="r"><button class="btn small primary" data-act="saveprice" data-id="${esc(c._id)}" disabled>Save</button></td></tr>`).join('') : emptyRow(4, 'No courts yet.')}</tbody></table></div>
      <div class="pad note">A new price applies to bookings made from now on. Existing bookings keep the fee they were booked at.</div>`,

    slots: () => `<div class="tablewrap"><table>
      <thead><tr><th>Court</th><th>Opens</th><th>Closes</th><th class="r">Slot length (min)</th><th class="r">Slots per day</th><th></th></tr></thead>
      <tbody>${courts.length ? courts.map((c) => `<tr data-row="${esc(c._id)}">
        <td>${name(c)}</td>
        <td><input class="inline-input" name="open" type="time" value="${esc(c.openTime)}" aria-label="Opening time for ${esc(c.name)}" /></td>
        <td><input class="inline-input" name="close" type="time" value="${esc(c.closeTime)}" aria-label="Closing time for ${esc(c.name)}" /></td>
        <td class="r"><input class="inline-input num-in" name="step" type="number" min="15" max="240" step="15" value="${esc(c.slotDurationMinutes)}" aria-label="Slot length for ${esc(c.name)}" /></td>
        <td class="r num slot-count">${slotCount(c.openTime, c.closeTime, c.slotDurationMinutes)}</td>
        <td class="r"><button class="btn small primary" data-act="saveslots" data-id="${esc(c._id)}" disabled>Save</button></td></tr>`).join('') : emptyRow(6, 'No courts yet.')}</tbody></table></div>
      <div class="pad note">Slots start at the opening time and repeat every slot length. A change is refused while an upcoming booking would no longer fit. The facility-wide hours are under <a href="#/settings">Opening hours</a>.</div>`,
  };

  async function load() {
    courts = (await api('/courts')).courts;
    $('#courtTable').innerHTML = tables[tab]();
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();

  const find = (id) => courts.find((c) => c._id === id);
  view.oninput = (e) => {
    const row = e.target.closest('tr[data-row]');
    if (!row) return;
    const c = find(row.dataset.row);
    if (tab === 'pricing') {
      const raw = row.querySelector('[name=price]').value; const n = Number(raw);
      const ok = raw !== '' && n >= 0;
      row.querySelector('.per-slot').textContent = ok ? `${peso(Math.round(n * c.slotDurationMinutes / 60))} per ${c.slotDurationMinutes}-min slot` : '-';
      row.querySelector('[data-act=saveprice]').disabled = !ok || n === c.pricePerHour;
    }
    if (tab === 'slots') {
      const open = row.querySelector('[name=open]').value; const close = row.querySelector('[name=close]').value; const step = Number(row.querySelector('[name=step]').value);
      row.querySelector('.slot-count').textContent = slotCount(open, close, step);
      const ok = open && close && step >= 15 && step <= 240 && mins(close) > mins(open);
      row.querySelector('[data-act=saveslots]').disabled = !ok || (open === c.openTime && close === c.closeTime && step === c.slotDurationMinutes);
    }
  };
  view.onchange = async (e) => {
    const sel = e.target.closest('select[data-act=status]');
    if (!sel) return;
    try {
      const r = await api(`/courts/${sel.dataset.id}/status`, { method: 'PATCH', body: { status: sel.value }, version: (find(sel.dataset.id) || {}).writeTS });
      toast(r.affectedBookings
        ? `Status updated. ${r.affectedBookings} upcoming booking${r.affectedBookings === 1 ? ' is' : 's are'} on this court - review them under Bookings.`
        : 'Status updated');
    } catch (err) { toast(err.message, true); }
    refreshView();
  };
  view.onclick = async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const c = find(b.dataset.id);
    if (b.dataset.act === 'edit') courtForm(c);
    if (b.dataset.act === 'price') priceForm(c);
    if (b.dataset.act === 'remove') removeCourt(c);
    if (b.dataset.act === 'saveprice' || b.dataset.act === 'saveslots') {
      const row = b.closest('tr');
      b.disabled = true; b.classList.add('is-busy');
      try {
        if (b.dataset.act === 'saveprice') {
          await api(`/courts/${c._id}/price`, { method: 'PATCH', body: { pricePerHour: Number(row.querySelector('[name=price]').value) }, version: c.writeTS });
          toast(`Price for ${c.name} updated`);
        } else {
          await api(`/courts/${c._id}`, { method: 'PUT', body: { openTime: row.querySelector('[name=open]').value, closeTime: row.querySelector('[name=close]').value, slotDurationMinutes: Number(row.querySelector('[name=step]').value) }, version: c.writeTS });
          toast(`Time slots for ${c.name} updated`);
        }
        refreshView();
      } catch (err) {
        toast(err.message, true);
        b.disabled = false; b.classList.remove('is-busy');
      }
    }
  };
}

function courtForm(c) {
  const isNew = !c;
  const v = c || { name: '', courtNumber: '', location: '', description: '', facilities: [], imageUrl: '', pricePerHour: '', status: 'available', openTime: '06:00', closeTime: '22:00', slotDurationMinutes: 60 };
  openModal(isNew ? 'Add court' : `Edit ${c.name}`, `
    <form id="courtForm">
      <div class="row2">
        ${field('Court name', `<input name="name" required value="${esc(v.name)}" placeholder="Court 5" />`)}
        ${field('Court number', `<input name="courtNumber" value="${esc(v.courtNumber)}" placeholder="C5" />`)}
      </div>
      ${field('Location', `<input name="location" required value="${esc(v.location)}" placeholder="Main Building, Ground Floor" />`)}
      ${field('Description', `<textarea name="description">${esc(v.description)}</textarea>`)}
      ${field('Facilities', `<input name="facilities" value="${esc((v.facilities || []).join(', '))}" placeholder="Indoor, Lighting, Restroom, Parking" />`, 'Separate with commas. Customers can filter by these.')}
      ${field('Court photo', `<input name="imageUrl" id="cfImage" value="${esc(v.imageUrl)}" placeholder="Pick a mockup below or paste https://..." />`, 'Leave empty to use an automatic mockup photo.')}
      <div class="photo-pick" id="cfPick">${COURT_PHOTOS.map((p) => `<button type="button" data-photo="${p}" class="${v.imageUrl === p ? 'on' : ''}" aria-label="Use mockup photo ${p.slice(-5, -4)}"><img src="${p}" alt="" /></button>`).join('')}</div>
      <div class="row3">
        ${field('Opens', `<input name="openTime" type="time" required value="${esc(v.openTime)}" />`)}
        ${field('Closes', `<input name="closeTime" type="time" required value="${esc(v.closeTime)}" />`)}
        ${field('Slot length (min)', `<input name="slotDurationMinutes" type="number" min="15" max="240" step="15" required value="${esc(v.slotDurationMinutes)}" />`)}
      </div>
      ${isNew ? `<div class="row2">
        ${field('Price per hour (₱)', '<input name="pricePerHour" type="number" min="0" step="1" required />')}
        ${field('Status', `<select name="status">${optionList(['available', 'unavailable', 'maintenance', 'closed'].map((s) => [s, s]), 'available')}</select>`)}
      </div>` : '<p class="muted" style="margin:12px 0 0;">Hours and slot length can only change while no upcoming booking would fall outside them.</p>'}
      <div class="dlg-foot"><button type="button" class="btn" id="cfCancel">Cancel</button><button type="submit" class="btn primary">${isNew ? 'Add court' : 'Save changes'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`, { wide: true });
  $('#cfCancel').onclick = closeModal;
  const markPick = () => $('#cfPick').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.photo === $('#cfImage').value.trim()));
  $('#cfPick').onclick = (e) => { const b = e.target.closest('[data-photo]'); if (!b) return; $('#cfImage').value = b.dataset.photo; markPick(); };
  $('#cfImage').oninput = markPick;
  onSubmit($('#courtForm'), async (data) => {
    data.slotDurationMinutes = Number(data.slotDurationMinutes);
    await api(isNew ? '/courts' : `/courts/${c._id}`, { method: isNew ? 'POST' : 'PUT', body: data, version: isNew ? undefined : c.writeTS });
    toast(isNew ? 'Court added' : 'Court updated');
    closeModal();
    refreshView();
  });
}

function priceForm(c) {
  openModal(`Price for ${c.name}`, `
    <form id="priceForm">
      ${field('Price per hour (₱)', `<input name="pricePerHour" type="number" min="0" step="1" required value="${esc(c.pricePerHour)}" />`,
        'Applies to new bookings. Bookings already made keep the fee they were booked at.')}
      <div class="dlg-foot"><button type="button" class="btn" id="prCancel">Cancel</button><button type="submit" class="btn primary">Save price</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#prCancel').onclick = closeModal;
  onSubmit($('#priceForm'), async (data) => {
    await api(`/courts/${c._id}/price`, { method: 'PATCH', body: { pricePerHour: Number(data.pricePerHour) }, version: c.writeTS });
    toast('Price updated');
    closeModal();
    refreshView();
  });
}

function removeCourt(c) {
  openModal(`Remove ${c.name}?`, `
    <form id="rmForm">
      <p>This deletes the court and its blocked slots. Past bookings stay in the records with the court's name.</p>
      ${c.upcomingBookings ? `<div class="msg note">${c.upcomingBookings} upcoming booking${c.upcomingBookings === 1 ? '' : 's'} on this court. Cancel or move ${c.upcomingBookings === 1 ? 'it' : 'them'} first, or set the court to "closed" instead.</div>` : ''}
      <div class="dlg-foot"><button type="button" class="btn" id="rmCancel">Keep court</button><button type="submit" class="btn solid-danger">Remove court</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#rmCancel').onclick = closeModal;
  onSubmit($('#rmForm'), async () => {
    await api(`/courts/${c._id}`, { method: 'DELETE', version: c.writeTS });
    toast('Court removed');
    closeModal();
    refreshView();
  });
}

/* =====================================================================
   AF-112  Hours & booking rules
   ===================================================================== */
/** The rules customers read (from the server, so it matches the customer pages word for word). */
const policyPreview = (lines) => [['booking', 'Booking'], ['cancellation', 'Cancellation and refunds'], ['payment', 'Payment']]
  .map(([k, t]) => `<h3>${t}</h3><ul>${(lines[k] || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');
const numField = (name, label, value, max, hint) => field(label, `<input name="${name}" type="number" min="0" max="${max}" step="1" required value="${esc(value)}" />`, hint);

async function renderSettings() {
  setHead('Hours & rules', 'Opening hours, booking rules and the cancellation policy');
  const { settings: s } = await api('/settings');
  const hasPin = s.facilityLat != null && s.facilityLng != null;
  const r = s.rules;
  view.innerHTML = `
    <div class="settings-grid">
    <div class="card"><div class="pad">
      <form id="setForm">
        <h2 style="font-size:15px;">Opening hours</h2>
        <div class="row2">
          ${field('Opens', `<input name="openTime" type="time" required value="${esc(s.openTime)}" />`)}
          ${field('Closes', `<input name="closeTime" type="time" required value="${esc(s.closeTime)}" />`)}
        </div>
        <label class="check"><input type="checkbox" name="applyToCourts" />
          <span><b>Also apply to every court now</b>New courts always start with these hours. Turn this on to change the courts you already have. It is refused if an upcoming booking would fall outside the new hours.</span></label>

        <h2 style="font-size:15px;margin-top:24px;">Booking rules</h2>
        <p class="sub" style="margin:4px 0 8px;">For customers only: staff can still book and move anything here in the admin console. 0 means no limit.</p>
        <div class="row3">
          ${numField('maxAdvanceDays', 'Book up to (days ahead)', r.maxAdvanceDays, 365, '0 = no limit')}
          ${numField('minNoticeHours', 'Book at least (hours before)', r.minNoticeHours, 168, '0 = right up to the start')}
          ${numField('maxUpcomingPerCustomer', 'Upcoming bookings per customer', r.maxUpcomingPerCustomer, 50, '0 = no limit')}
        </div>
        <p class="sub" style="margin:8px 0 0;">Every new booking waits as "Pending approval" and holds its slot until staff approve or reject it under <a href="#/bookings?status=pending">Waiting for approval</a>. A customer who reschedules goes back to pending too.</p>

        <h2 style="font-size:15px;margin-top:24px;">Cancellation and refunds</h2>
        <div class="row2">
          ${numField('cancelCutoffHours', 'Customers can cancel until (hours before)', r.cancelCutoffHours, 168, '0 = right up to the start')}
          ${numField('rescheduleCutoffHours', 'Customers can move a booking until (hours before)', r.rescheduleCutoffHours, 168, '0 = right up to the start')}
        </div>
        <div class="row2">
          ${numField('fullRefundHours', 'Full refund if cancelled at least (hours before)', r.fullRefundHours, 720, '0 = always a full refund')}
          ${numField('lateRefundPercent', 'Later cancellations get back (%)', r.lateRefundPercent, 100, '100 = full, 0 = nothing')}
        </div>
        ${field('Note for customers (optional)', `<textarea name="policyNote" rows="2" maxlength="500" placeholder="e.g. No-shows are not refunded.">${esc(r.policyNote)}</textarea>`)}
        <p class="sub" style="margin:0;">When the facility cancels or does not approve a paid booking, it is always refunded in full. What is owed shows under <a href="#/refunds">Payments, Refunds</a>.</p>


        <div class="dlg-foot" style="justify-content:flex-start;"><button class="btn primary" type="submit">Save settings</button></div>
        <div class="msg error hidden" role="alert"></div>
      </form>
    </div></div>
    <div class="settings-side">
    <div class="card"><div class="pad policy-preview">
      <h2 style="font-size:15px;margin-top:0;">What customers read</h2>
      <p class="sub" style="margin:2px 0 6px;">On the booking page, My Bookings and Terms. It updates when you save.</p>
      <div id="policyPreview">${policyPreview(s.policyLines)}</div>
    </div></div>
    <div class="card" style="margin-top:12px;"><div class="pad" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <span><b>Facility location</b><span class="sub" style="display:block;">${hasPin ? 'Pinned on the map.' : 'Not pinned yet.'} The map pin, address and directions customers see.</span></span>
      <a class="btn" href="#/location">Open Location</a></div></div>
    <div class="card" style="margin-top:12px;"><div class="pad" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <span><b>Integrations</b><span class="sub" style="display:block;">Google, Turnstile, map, weather and the custom API: turn them on or off and see how to set them up.</span></span>
      <a class="btn" href="#/integrations">Manage integrations</a></div></div>
    </div>
    </div>`;
  // the location and integrations cards sit in the side column on wide screens
  const form = $('#setForm');
  const RULE_KEYS = ['maxAdvanceDays', 'minNoticeHours', 'maxUpcomingPerCustomer', 'cancelCutoffHours', 'rescheduleCutoffHours', 'fullRefundHours', 'lateRefundPercent', 'policyNote'];
  onSubmit(form, async (data) => {
    const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, data[k]]));
    const res = await api('/settings', { method: 'PUT', body: {
      openTime: data.openTime, closeTime: data.closeTime, applyToCourts: data.applyToCourts, rules,
    }, version: s.writeTS });
    if (res.settings) {
      s.writeTS = res.settings.writeTS; // the form stays open: the next save builds on this version
      $('#policyPreview').innerHTML = policyPreview(res.settings.policyLines);
    }
    toast(res.updatedCourts ? `Saved. Hours updated on ${res.updatedCourts} court${res.updatedCourts === 1 ? '' : 's'}.` : 'Settings saved');
    form.querySelector('[name=applyToCourts]').checked = false;
  });
}

/** AF-141: this account's sessions, on My account. */
async function loadMySessions() {
  const box = $('#mySessions');
  if (!box) return;
  try {
    const { sessions } = await userApi('/sessions');
    box.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Device</th><th>Where</th><th>Signed in</th><th>Last active</th><th></th></tr></thead><tbody>
      ${sessions.map((x) => `<tr><td><b>${esc(x.device)}</b>${x.current ? ` ${pillX('u-active', 'This device')}` : ''}<span class="sub">${esc(x.ip)}</span></td>
        <td>${x.portal === 'admin' ? 'Admin console' : 'Customer site'}</td><td>${esc(fmtStamp(x.signedInAt))}</td><td>${esc(fmtStamp(x.lastSeenAt))}</td>
        <td class="r">${x.current ? '' : `<button class="btn small" data-end="${esc(x.id)}">Sign out</button>`}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('#endOthers').hidden = !sessions.some((x) => !x.current);
    box.onclick = async (e) => {
      const b = e.target.closest('[data-end]');
      if (!b) return;
      b.disabled = true;
      try { await userApi(`/sessions/${b.dataset.end}`, { method: 'DELETE' }); toast('That device was signed out'); } catch (err) { toast(err.message, true); }
      loadMySessions();
    };
    $('#endOthers').onclick = async () => {
      try { const r = await userApi('/sessions/end-others', { method: 'POST' }); toast(`${r.ended} other device${r.ended === 1 ? '' : 's'} signed out`); } catch (err) { toast(err.message, true); }
      loadMySessions();
    };
  } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

/* =====================================================================
   Facility location: one map pin behind the customer Location page,
   the "Find us" maps and the weather forecast
   ===================================================================== */
function locationStatus(pinned, mapOff) {
  if (!pinned) return { cls: 'note', text: "Not pinned yet: customers can't see the map or get directions, and the weather uses Metro Manila until you pin it." };
  if (mapOff) return { cls: 'note', text: 'Pinned, but the map is turned off under Integrations: customers get the address and directions without a map.' };
  return { cls: 'ok', text: 'Pinned. Customers see the map and directions, and the forecast is for this spot.' };
}

/** Courts grouped by their Location field ("Main Building, Ground Floor"), areas A-Z. */
function courtsByArea(courts) {
  const groups = new Map();
  courts.forEach((c) => {
    const area = String(c.location || '').trim() || 'No area set';
    const key = area.toLowerCase();
    if (!groups.has(key)) groups.set(key, { area, courts: [] });
    groups.get(key).courts.push(c);
  });
  return [...groups.values()].sort((a, b) => a.area.localeCompare(b.area, 'en', { numeric: true }));
}

async function renderLocation() {
  setHead('Location', 'The map pin, address and directions customers see');
  const [{ settings: s }, ints, courts] = await Promise.all([
    api('/settings'),
    api('/integrations').then((r) => r.integrations).catch(() => null),
    can('courts.view') ? api('/courts').then((r) => r.courts).catch(() => null) : null,
  ]);
  const hasPin = s.facilityLat != null && s.facilityLng != null;
  const mapOff = Boolean(ints && ints.maps && !ints.maps.active);
  const st = locationStatus(hasPin, mapOff);
  const areas = courts ? courtsByArea(courts) : [];
  view.innerHTML = `
    <div class="grid2 loc-admin">
      <div class="card"><div class="pad">
        <form id="locForm">
          <h2 style="font-size:15px;">Map pin</h2>
          <p class="sub" style="margin:4px 0 8px;">Search for the address, use your current location, or click the map. Drag the pin onto the entrance so directions end at the right spot.</p>
          <div id="facStatus" class="msg ${st.cls}" style="margin:0 0 8px;">${esc(st.text)}</div>
          <div class="fac-search">
            <input id="facQuery" type="search" placeholder="Search an address, e.g. Rizal Park, Manila" aria-label="Search an address" />
            <button class="btn" type="button" id="facFind">Search</button>
            <button class="btn" type="button" id="facHere">Use my current location</button>
          </div>
          <ul id="facResults" class="fac-results" hidden></ul>
          <div id="facMap" class="fac-map"></div>
          <div class="row2" style="margin-top:8px;">
            ${field('Latitude', `<input name="facilityLat" id="facLat" inputmode="decimal" value="${hasPin ? esc(s.facilityLat) : ''}" placeholder="e.g. 14.5995" />`)}
            ${field('Longitude', `<input name="facilityLng" id="facLng" inputmode="decimal" value="${hasPin ? esc(s.facilityLng) : ''}" placeholder="e.g. 120.9842" />`)}
          </div>
          ${field('Address', `<input name="facilityAddress" maxlength="200" value="${esc(s.facilityAddress || '')}" placeholder="Street, barangay, city" />`, 'Optional. Customers see it with the map and in "Add to calendar". Clear both coordinates and save to remove the pin.')}
          <div class="dlg-foot" style="justify-content:flex-start;">
            <button class="btn primary" type="submit">Save location</button>
            <a class="btn" id="locCheck" href="https://www.google.com/maps" target="_blank" rel="noopener">Check in Google Maps</a>
          </div>
          <div class="msg error hidden" role="alert"></div>
        </form>
      </div></div>
      <div>
        <div class="card"><div class="pad">
          <h2 style="font-size:15px;">Where customers see it</h2>
          <ul class="loc-uses">
            <li><b>Location</b> in the customer menu: the map, directions (Google Maps, Waze, OpenStreetMap), opening hours and where each court is</li>
            <li>A <b>Find us</b> map on the dashboard, Courts, each court's page, the booking page and Support</li>
            <li>The <b>weather forecast</b> for staff and for customers picking a date</li>
          </ul>
        </div></div>
        ${courts ? `<div class="card" style="margin-top:16px;">
          <h2>Courts by area</h2>
          <ul class="facts">${areas.length ? areas.map((g) => `
            <li><span><b>${esc(g.area)}</b><span class="loc-courts">${g.courts.map((c) => `${esc(c.name)}${c.status !== 'available' ? ` ${pillC(c.status)}` : ''}`).join(', ')}</span></span>
              <span class="muted">${g.courts.length}</span></li>`).join('') : '<li class="muted">No courts yet.</li>'}</ul>
          <div class="pad sub" style="padding-top:0;">Customers see this list on their Location page. Each court's area is its Location field: change it under <a href="#/courts">Courts</a> → Edit.</div>
        </div>` : ''}
      </div>
    </div>`;

  facMovePin = null;
  addressTouched = Boolean(s.facilityAddress);
  wireFacilitySearch();
  if (mapOff) {
    $('#facMap').outerHTML = '<p class="sub" id="facMap">The map is turned off under <a href="#/integrations">Integrations</a>. You can still type the latitude and longitude.</p>';
  } else initFacilityMap(hasPin ? [s.facilityLat, s.facilityLng] : null);

  // open the pin as it is now (also before saving) in Google Maps, to double-check the spot
  $('#locCheck').addEventListener('click', (e) => {
    const lat = parseFloat($('#facLat').value);
    const lng = parseFloat($('#facLng').value);
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) {
      e.preventDefault();
      toast('Pin the facility first', true);
      return;
    }
    e.currentTarget.href = `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`;
  });

  onSubmit($('#locForm'), async (data) => {
    const r = await api('/settings', { method: 'PUT', body: {
      facilityLat: data.facilityLat.trim(), facilityLng: data.facilityLng.trim(), facilityAddress: data.facilityAddress,
    }, version: s.writeTS });
    if (r.settings) s.writeTS = r.settings.writeTS; // the form stays open: the next save builds on this version
    const pinned = Boolean(r.settings && r.settings.facilityLat != null);
    toast(pinned ? 'Location saved' : 'Saved. The facility is not pinned.');
    const next = locationStatus(pinned, mapOff);
    const box = $('#facStatus');
    if (box) { box.className = `msg ${next.cls}`; box.textContent = next.text; }
  });
}

/* ---------- Leaflet + OpenStreetMap: facility location picker ---------- */
let leafletReady = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletReady) {
    leafletReady = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.onload = resolve;
      js.onerror = () => { leafletReady = null; reject(new Error('Map could not load')); };
      document.head.appendChild(js);
    });
  }
  return leafletReady;
}

/* ---------- pinning helpers: address search, current location, address from a point ---------- */
let facMovePin = null; // set once the map is ready
let addressTouched = false; // don't overwrite an address the admin typed
async function fillAddress(lat, lng) {
  const input = document.querySelector('[name=facilityAddress]');
  if (!input || (addressTouched && input.value.trim())) return;
  try {
    const { address } = await api(`/integrations/geocode?lat=${lat}&lng=${lng}`);
    if (address && !addressTouched) input.value = address.slice(0, 200);
  } catch (e) { /* the address is optional */ }
}
function pinFacility(lat, lng, label) {
  $('#facLat').value = Number(lat).toFixed(6);
  $('#facLng').value = Number(lng).toFixed(6);
  if (label && !addressTouched) document.querySelector('[name=facilityAddress]').value = label.slice(0, 200);
  if (facMovePin) facMovePin(lat, lng, 17);
  const st = $('#facStatus');
  st.className = 'msg note';
  st.textContent = 'Pin moved. Press "Save location" to keep it.';
}
function wireFacilitySearch() {
  const results = $('#facResults');
  const addr = document.querySelector('[name=facilityAddress]');
  addr.addEventListener('input', () => { addressTouched = true; });
  const find = async () => {
    const q = $('#facQuery').value.trim();
    if (q.length < 3) { results.hidden = false; results.innerHTML = '<li class="muted">Type at least 3 letters.</li>'; return; }
    $('#facFind').disabled = true;
    results.hidden = false;
    results.innerHTML = '<li class="muted">Searching…</li>';
    try {
      const { results: list } = await api(`/integrations/geocode?q=${encodeURIComponent(q)}`);
      results.innerHTML = list.length
        ? list.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('')
        : '<li class="muted">No places found. Try a nearby landmark or the city, then click the exact spot on the map.</li>';
      results.onclick = (e) => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        const r = list[Number(b.dataset.i)];
        pinFacility(r.lat, r.lng, r.label);
        results.hidden = true;
      };
    } catch (e) { results.innerHTML = `<li class="muted">${esc(e.message)}</li>`; }
    $('#facFind').disabled = false;
  };
  $('#facFind').onclick = find;
  $('#facQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
  $('#facHere').onclick = () => {
    if (!navigator.geolocation) return toast('This browser cannot share its location', true);
    $('#facHere').disabled = true;
    navigator.geolocation.getCurrentPosition(
      (p) => { $('#facHere').disabled = false; pinFacility(p.coords.latitude, p.coords.longitude); fillAddress(p.coords.latitude, p.coords.longitude); },
      () => { $('#facHere').disabled = false; toast('Location not available. Allow location access (the page must be on https or localhost), or search the address.', true); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
}

async function initFacilityMap(pin) {
  const box = $('#facMap');
  try { await loadLeaflet(); } catch (e) {
    box.innerHTML = '<div class="empty">The map could not load. You can still type the latitude and longitude.</div>';
    return;
  }
  if (!box.isConnected) return;
  const map = L.map(box).setView(pin || [14.5995, 120.9842], pin ? 16 : 11); // default: Metro Manila
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  let marker = null;
  const setInputs = (lat, lng) => { $('#facLat').value = lat.toFixed(6); $('#facLng').value = lng.toFixed(6); };
  const put = (lat, lng, pan) => {
    const ll = [Number(lat), Number(lng)];
    if (!marker) {
      marker = L.marker(ll, { draggable: true }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); setInputs(p.lat, p.lng); fillAddress(p.lat, p.lng); });
    } else marker.setLatLng(ll);
    if (pan) map.panTo(ll);
  };
  if (pin) put(pin[0], pin[1]);
  facMovePin = (lat, lng, zoom) => { put(lat, lng, true); if (zoom) map.setView([lat, lng], zoom); };
  map.on('click', (e) => { put(e.latlng.lat, e.latlng.lng); setInputs(e.latlng.lat, e.latlng.lng); fillAddress(e.latlng.lat, e.latlng.lng); });
  const typed = () => {
    const lat = parseFloat($('#facLat').value);
    const lng = parseFloat($('#facLng').value);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) put(lat, lng, true);
  };
  $('#facLat').onchange = typed;
  $('#facLng').onchange = typed;
  setTimeout(() => map.invalidateSize(), 50);
}

/* =====================================================================
   Integrations page: turn each third-party service on/off.
   A service runs only when its keys are in backend/.env AND it is
   switched on here. Setup steps live in a "Set up" / "Details" dialog.
   ===================================================================== */
const INT_ICON = {
  googleSignIn: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  turnstile: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  googleCalendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  maps: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  weather: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  qrCheckin: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  webhook: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
};

const INTEGRATIONS = [
  {
    key: 'googleSignIn', name: 'Google Sign-In', group: 'Sign-in',
    what: 'Customers and staff sign in with Google',
    env: ['GOOGLE_CLIENT_ID', 'CUSTOM_GOOGLE_CLIENT_ID'],
    steps: [
      'Google Cloud Console → APIs & Services → Credentials → create an OAuth client ID ("Web application").',
      'Add your site (e.g. http://localhost:5000) under "Authorized JavaScript origins".',
      'Put the client ID in <code>GOOGLE_CLIENT_ID</code> and restart the server. Staff use it on the admin sign-in page, and customers use it too unless you set the next one.',
      'Optional: give customers their own Google client (its own name and logo on Google\'s sign-in screen, or a customer site on another address). Create a second OAuth client ID the same way, put it in <code>CUSTOM_GOOGLE_CLIENT_ID</code> and restart the server.',
    ],
    more: 'Customers: "Continue with Google" on the login and sign-up pages; a new email gets a customer account. Staff: only existing staff/admin accounts with the same email can open the admin console.',
  },
  {
    key: 'turnstile', name: 'Cloudflare Turnstile', group: 'Sign-in',
    what: 'Human check on sign-in, sign-up and password reset',
    env: ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'],
    steps: [
      'dash.cloudflare.com → Turnstile → Add site.',
      'Put the site key and secret key in backend/.env and restart the server.',
    ],
    more: 'Runs invisibly on the admin sign-in and the customer login, sign-up and forgot-password pages. Testing keys that always pass are listed in backend/.env.example.',
  },
  {
    key: 'googleCalendar', name: 'Google Calendar', group: 'Scheduling',
    what: 'Bookings on the facility calendar + "Add to calendar" for customers',
    env: ['GOOGLE_CALENDAR_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'],
    steps: [
      'Google Cloud Console: enable the Google Calendar API, create a service account and download a JSON key.',
      'Share the facility calendar with the service account email ("Make changes to events").',
      'Put the calendar ID, service account email and private key in backend/.env and restart the server.',
    ],
    more: 'Facility calendar events update when a booking is moved, cancelled or rejected. Customers see an "Add to Google Calendar" button on confirmed bookings.',
  },
  {
    key: 'maps', name: 'Map', group: 'Facility',
    what: 'Facility map for staff and customers (OpenStreetMap)',
    env: [],
    steps: ['Nothing to set up. Pin the facility under <a href="#/location">Location</a>.'],
  },
  {
    key: 'weather', name: 'Weather', group: 'Facility',
    what: 'Rain forecast for staff and for customers picking a date',
    env: [],
    steps: ['Nothing to set up. It uses the facility pinned under <a href="#/location">Location</a>.'],
  },
  {
    key: 'email', name: 'Email', group: 'Messaging',
    what: 'Email customers booking updates (with a calendar file)',
    env: ['RESEND_API_KEY', 'EMAIL_FROM'],
    steps: [
      'Recommended: sign up at resend.com (free tier), verify your domain and create an API key.',
      'Put it in <code>RESEND_API_KEY</code> and set <code>EMAIL_FROM</code>, e.g. <code>MAKI\'s PickleBall &lt;bookings@yourdomain.com&gt;</code>.',
      'Or keep using an SMTP mailbox (<code>EMAIL_HOST</code>, <code>EMAIL_PORT</code>, <code>EMAIL_USER</code>, <code>EMAIL_PASS</code>), which can land in spam more often.',
      'Restart the server.',
    ],
    more: 'Sent for: booking received, approved or not approved, cancelled by the facility, moved, payment received, refund, expired and the 2-hour reminder, to customers who have not turned emails off on their Profile page. The approval email includes a calendar file with a 2-hour reminder. Password resets, admin one-time codes and integration change alerts are always sent when email is set up, even if this switch is off.',
  },
  {
    key: 'qrCheckin', name: 'QR check-in', group: 'Check-in',
    what: 'Customers show a QR code, staff scan it at the desk',
    env: [],
    steps: [
      'Nothing to set up. Confirmed bookings show a QR code on the customer\'s booking page.',
      'At the desk, open <a href="#/checkins">Check-ins</a> → "Scan QR" and point the camera at the code (or type the reference).',
      'The camera needs the admin console on https, or on localhost while testing.',
    ],
  },
  {
    // set up in its own dialog (openWebhook): the address and secret are saved in the database, not backend/.env
    key: 'webhook', name: 'Custom API (webhook)', group: 'Your own system',
    what: 'Send booking events to your own system or app',
    env: [],
    steps: [],
  },
];

/**
 * Server settings (backend/.env), from the server's own check: edits waiting for a restart, values that can't work,
 * keys the app doesn't use, and what changed at the last start. Only key names ever reach the browser.
 */
function serverSettingsCard(e) {
  if (!e) return ''; // an older server
  const items = [];
  if (e.pendingRestart && e.pendingRestart.length) {
    items.push(`<div class="msg note env-msg"><b>backend/.env was edited after the server started</b> (${esc(e.pendingRestart.join('; '))}).
      Restart the server to use the new values.${e.pendingProblems && e.pendingProblems.length
        ? `<ul>${e.pendingProblems.map((p) => `<li>After the restart: ${esc(p.message)}.</li>`).join('')}</ul>` : ''}</div>`);
  }
  if (e.problems && e.problems.length) {
    items.push(`<div class="msg error env-msg"><b>${e.problems.length === 1 ? "A setting won't work" : `${e.problems.length} settings won't work`}</b>
      <ul>${e.problems.map((p) => `<li>${esc(p.message)}.</li>`).join('')}</ul></div>`);
  }
  if (e.unused && e.unused.length) {
    items.push(`<p class="sub env-line">Not used by this app, so you can delete ${e.unused.length === 1 ? 'it' : 'them'}:
      ${e.unused.map((u) => `<code>${esc(u.key)}</code>${u.note ? ` (${esc(u.note)})` : ''}`).join(', ')}.</p>`);
  }
  if (e.lastChanges && e.lastChanges.length && e.changedAt) {
    items.push(`<p class="sub env-line">Changed at the start on ${esc(fmtStamp(e.changedAt))}: ${esc(e.lastChanges.join('; '))}.</p>`);
  }
  if (!items.length) return '';
  return `<div class="card env-card"><div class="pad">
    <h2 class="env-title">Server settings <span class="muted">backend/.env</span></h2>${items.join('')}
    <p class="sub env-line">Only the names of settings are shown, never their values. Every admin is notified when they change.</p>
  </div></div>`;
}

/** One short line that needs the admin's attention, or ''. */
function integrationNote(x, st, facility) {
  if (!st.active) return '';
  if (x.key === 'weather' && facility.lat == null) return 'Using Metro Manila until you <a href="#/location">pin the facility</a>';
  if (x.key === 'maps' && facility.lat == null) return 'Not pinned yet: customers can\'t see the map. <a href="#/location">Pin the facility</a>';
  if (x.key === 'webhook' && st.failed) return `${st.failed} event${st.failed === 1 ? '' : 's'} could not be delivered in the last day. Open Details to see why.`;
  return '';
}

async function renderIntegrationsPage() {
  const d = await api('/integrations');
  // A service the server doesn't report means the server is running older code than this page:
  // show it as "restart needed" instead of failing.
  const i = { ...d.integrations };
  const unknown = INTEGRATIONS.filter((x) => !i[x.key]).map((x) => x.name);
  INTEGRATIONS.forEach((x) => { if (!i[x.key]) i[x.key] = { configured: false, switchedOn: false, active: false, unknown: true }; });
  i.webhook = { ...i.webhook, failed: d.webhookFailed || 0 };
  const running = INTEGRATIONS.filter((x) => i[x.key].active).length;
  const sec = d.security; // missing when the server runs older code
  setHead('Integrations', `${running} of ${INTEGRATIONS.length} running · turning one on or off asks for your PIN and a one-time code`,
    '<button class="btn" type="button" id="intReset">Reset to defaults</button>');

  const status = (st) => (st.unknown ? ['none', 'Restart needed'] : st.active ? ['on', 'On'] : st.configured ? ['off', 'Off'] : ['none', 'Not set up']);
  const envProblems = (d.env && d.env.problems) || [];
  const row = (x) => {
    const st = i[x.key];
    const [cls, label] = status(st);
    const note = integrationNote(x, st, d.facility);
    const envKeys = [...new Set(envProblems.filter((p) => p.service === x.key).map((p) => p.key))];
    return `<li class="int-row" data-key="${x.key}">
      <span class="int-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${INT_ICON[x.key]}</svg></span>
      <span class="int-main">
        <b>${esc(x.name)}</b>
        <span class="int-what">${esc(x.what)}</span>
        ${note ? `<span class="int-warn">${note}</span>` : ''}
        ${envKeys.length ? `<span class="int-warn bad">Check ${esc(andList(envKeys))} in backend/.env (see Server settings above)</span>` : ''}
      </span>
      <span class="int-state ${cls}"><i aria-hidden="true"></i>${label}</span>
      ${st.configured
        ? `<button class="btn small ghost" type="button" data-guide="${x.key}">Details</button>
           <label class="switch"><input type="checkbox" data-int="${x.key}" ${st.switchedOn ? 'checked' : ''} aria-label="${esc(x.name)}" /><span></span></label>`
        : `<button class="btn small" type="button" data-guide="${x.key}">Set up</button><span class="switch-gap" aria-hidden="true"></span>`}
    </li>`;
  };

  const groups = [...new Set(INTEGRATIONS.map((x) => x.group))];
  view.innerHTML = `${unknown.length ? `<div class="msg note" role="status" style="margin:0 0 12px;">
      The server is running an older version and doesn't know about: ${esc(unknown.join(', '))}.
      Restart it (Ctrl + C, then <code>npm --prefix backend start</code>) and reload this page.</div>` : ''}
    ${serverSettingsCard(d.env)}
    <div class="card int-list">${groups.map((g) => `
      <h2 class="int-group">${esc(g)}</h2>
      <ul>${INTEGRATIONS.filter((x) => x.group === g).map(row).join('')}</ul>`).join('')}
    </div>
    ${sec && !sec.canSendCodes ? `<div class="msg error int-foot" role="status">Integrations can't be turned on or off until email is set up:
      the one-time codes are sent by email. See <b>Email</b> above.</div>` : ''}
    ${sec && sec.viaConsole ? `<div class="msg note int-foot" role="status">Email is not set up on this server, so one-time codes are printed in the
      <b>server console</b> (development only). Set up <b>Email</b> above to get them by email.</div>` : ''}
    <p class="sub int-foot">Keys stay in backend/.env on the server and are never shown here (the custom API's signing secret is kept encrypted in the database).
      Turning a service on or off asks for your security PIN, then a one-time code${sec && sec.canSendCodes && !sec.viaConsole ? ` sent to ${esc(andList(sec.codeTo))}` : ''}.
      Every admin is alerted about each change.</p>`;

  view.onchange = (e) => {
    const box = e.target.closest('input[data-int]');
    if (!box) return;
    box.disabled = true; // keeps its new position until the change is confirmed or cancelled
    if (!sec) { toast('The server is running an older version. Restart it, then reload this page.', true); renderIntegrationsPage(); return; }
    changeIntegrations({ [box.dataset.int]: box.checked }, sec);
  };
  view.onclick = (e) => {
    const b = e.target.closest('[data-guide]');
    if (!b) return;
    if (b.dataset.guide === 'webhook') return openWebhook();
    integrationGuide(INTEGRATIONS.find((x) => x.key === b.dataset.guide), i[b.dataset.guide], d.facility);
  };
  $('#intReset').onclick = () => {
    if (!sec) return toast('The server is running an older version. Restart it, then reload this page.', true);
    openResetIntegrations();
  };
  refreshView = renderIntegrationsPage;
}

/* ---------- Two-step check before an integration is turned on or off ----------
   1. the admin's security PIN (created here the first time, or under My account), then
   2. a 6-digit code the server sends to the admin's email.
   The server keeps the change with the code, so the code approves exactly this change. */
const PIN_RE = /^\d{4,6}$/;
const pinField = (name, label, hint = '', ac = 'off') => field(label,
  `<input name="${name}" type="password" inputmode="numeric" pattern="[0-9]{4,6}" minlength="4" maxlength="6" title="4 to 6 digits" required autocomplete="${ac}" />`, hint);
const intName = (key) => (INTEGRATIONS.find((x) => x.key === key) || { name: key }).name;
const andList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');

function changeIntegrations(switches, sec) {
  const what = andList(Object.entries(switches).map(([k, on]) => `turn ${on ? 'on' : 'off'} ${intName(k)}`)).replace(/^./, (c) => c.toUpperCase());
  twoStepChange({
    what,
    sec,
    start: (pin) => api('/integrations/verify', { method: 'POST', body: { switches, pin } }),
    resend: (challengeId) => api('/integrations/verify/resend', { method: 'POST', body: { challengeId } }),
    confirm: (challengeId, otp) => api('/integrations', { method: 'PUT', body: { challengeId, otp } }),
    done: (res) => {
      const changed = Object.entries(res.changed).map(([k, on]) => `${intName(k)} ${on ? 'on' : 'off'}`).join(', ');
      toast(`${changed}${res.alertEmailed ? '. The admins were emailed about it.' : ''}`);
    },
    // closing the dialog at any step (Cancel, Esc, done) redraws the page, so every switch shows what is saved
    onClose: () => { if (currentView === 'integrations') renderIntegrationsPage(); },
  });
}

/**
 * The two-step check before a sensitive change, in the shared dialog: the admin's security PIN (created
 * here the first time), then a one-time code. The server keeps the change with the code, so the code
 * approves exactly this change.
 *   what     what is being changed, shown on every step
 *   start    (pin) => challenge               step 1: sends the change with the PIN
 *   resend   (challengeId) => challenge       a new code
 *   confirm  (challengeId, otp) => result     step 2: the server applies the change
 *   done     (result) => true when it shows something new in the dialog (it then stays open)
 *   onClose  () => ...                        whenever the dialog closes (Cancel, Esc or done)
 */
function twoStepChange({ what, sec, start, resend, confirm, done, onClose }) {
  let closed = false;
  dlg.addEventListener('close', () => { closed = true; if (onClose) onClose(); }, { once: true });

  const show = (title, html, focusSel) => {
    openModal(title, html);
    modalBody.onclick = (e) => { if (e.target.closest('[data-close], a[href^="#/"]')) closeModal(); };
    const el = $(focusSel, modalBody);
    if (el) setTimeout(() => el.focus(), 30);
  };
  const head = (step) => `<p style="margin-top:0;"><b>${esc(what)}</b></p><p class="sub step-note">Step ${step} of 2. `;
  const buttons = (submit, extra = '') => `<div class="msg error hidden" role="alert"></div>
    <div class="dlg-foot">${extra}<button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${submit}</button></div>`;
  const whereText = (r) => {
    if (!r.viaConsole) return `We sent a 6-digit code to <b>${esc(andList(r.sentTo))}</b>.`;
    return r.emailFailed
      ? 'The email could not be sent just now, so the code was printed in the <b>server console</b> (the window running the backend, which also shows why).'
      : 'Email is not set up on this server, so the code was printed in the <b>server console</b> (the window running the backend).';
  };
  const codeDest = sec.viaConsole ? 'shown in the server console (email is not set up)' : `sent to ${andList(sec.codeTo)}`;

  const askCode = (r) => {
    if (closed) return;
    const { challengeId } = r;
    show('Enter the one-time code', `${head(2)}<span id="codeWhere">${whereText(r)}</span></p>
      <form id="codeStep">
        ${field('6-digit code', '<input name="otp" class="otp-input" type="text" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" title="6 digits" required autocomplete="one-time-code" />',
          `It works once and expires in ${esc(r.expiresInMinutes || 10)} minutes.`)}
        ${buttons('Confirm change', r.resendsLeft > 0 ? '<button type="button" class="btn foot-left" id="otpResend" disabled></button>' : '')}
      </form>`, 'input[name=otp]');

    const again = $('#otpResend');
    if (again) {
      let wait = r.resendIn || 30;
      const paint = () => { again.disabled = wait > 0; again.textContent = wait > 0 ? `New code in ${wait}s` : 'Send a new code'; };
      paint();
      const timer = setInterval(() => {
        if (closed || !again.isConnected) return clearInterval(timer);
        if (wait > 0) { wait -= 1; paint(); }
      }, 1000);
      again.onclick = async () => {
        again.disabled = true; again.classList.add('is-busy');
        try {
          const n = await resend(challengeId);
          $('#codeWhere').innerHTML = whereText(n);
          toast('New code sent. The old one no longer works.');
          if (n.resendsLeft <= 0) { clearInterval(timer); again.remove(); return; }
          wait = n.resendIn || 30;
        } catch (ex) { showErr($('#codeStep .msg'), ex.message); }
        again.classList.remove('is-busy');
        paint();
      };
    }

    onSubmit($('#codeStep'), async (d) => {
      const otp = String(d.otp || '').replace(/\D/g, '');
      if (otp.length !== 6) throw new Error('Enter the 6-digit code.');
      const res = await confirm(challengeId, otp);
      if (done && done(res) === true) { // done() shows something new in the dialog, which stays open
        if (closed && onClose) dlg.addEventListener('close', onClose, { once: true }); // it was closed meanwhile and opened again
        return;
      }
      if (!closed) closeModal(); // the close handler (onClose) redraws the page
      else if (onClose) onClose();
    });
  };

  const sendCode = (pin) => start(pin);

  const askPin = (error) => {
    if (closed) return;
    show('Enter your security PIN', `${head(1)}After your PIN, you get a one-time code ${esc(codeDest)}.</p>
      <form id="pinStep">
        ${pinField('pin', 'Security PIN', 'Forgot it? Set a new one with your password under <a href="#/profile">My account</a>.')}
        ${buttons('Send code')}
      </form>`, 'input[name=pin]');
    if (error) showErr($('#pinStep .msg'), error);
    onSubmit($('#pinStep'), async (d) => {
      if (!PIN_RE.test(d.pin)) throw new Error('Your PIN is 4 to 6 digits.');
      askCode(await sendCode(d.pin));
    });
  };

  const createPin = () => {
    show('Create your security PIN', `${head(1)}This change takes two checks: a security PIN that only you know,
      then a one-time code ${esc(codeDest)}. Create your PIN to go on.</p>
      <form id="pinNew">
        ${field('Your account password', '<input name="password" type="password" required autocomplete="current-password" />', 'So that only you can set your PIN.')}
        <div class="row2">${pinField('pin', 'New PIN', '4 to 6 digits. Not 1234 or 0000.', 'new-password')}${pinField('confirm', 'Type the PIN again', '', 'new-password')}</div>
        ${buttons('Create PIN and send code')}
      </form>`, 'input[name=password]');
    onSubmit($('#pinNew'), async (d) => {
      if (!PIN_RE.test(d.pin)) throw new Error('Use 4 to 6 digits for your PIN.');
      if (d.pin !== d.confirm) throw new Error('The two PINs do not match.');
      await api('/security/pin', { method: 'PUT', body: { password: d.password, pin: d.pin } });
      sec.pinSet = true;
      if (state.me) state.me.pinSet = true;
      toast('Security PIN created');
      let r;
      try { r = await sendCode(d.pin); } catch (ex) { return askPin(`Your PIN was created, but no code was sent: ${ex.message}`); }
      askCode(r);
    });
  };

  if (!sec.canSendCodes) {
    show('Set up email first', `<p style="margin-top:0;">This change needs a one-time code sent to your email, but email is not set up on the server.</p>
      <p class="sub">Add <code>RESEND_API_KEY</code> (or <code>EMAIL_HOST</code>, <code>EMAIL_PORT</code>, <code>EMAIL_USER</code> and <code>EMAIL_PASS</code>) to backend/.env and restart the server.</p>
      <div class="dlg-foot"><button type="button" class="btn" data-close>Close</button></div>`, '[data-close]');
    return;
  }
  if (sec.pinSet) askPin(); else createPin();
}

/** Setup steps and details for one service, in the shared dialog. */
function integrationGuide(x, st, facility) {
  const facts = [];
  if (x.key === 'googleSignIn' && st.configured && st.customerClient) {
    facts.push(st.staffClient ? 'Staff and admins: the client ID in <code>GOOGLE_CLIENT_ID</code> (admin sign-in page).'
      : 'No <code>GOOGLE_CLIENT_ID</code>, so the admin sign-in page has no Google button.');
    facts.push(st.customerClient === 'own'
      ? 'Customers: their own client ID in <code>CUSTOM_GOOGLE_CLIENT_ID</code> (login and sign-up pages).'
      : 'Customers: the same client ID as staff. Set <code>CUSTOM_GOOGLE_CLIENT_ID</code> to give them their own.');
  }
  if (x.key === 'maps' && facility.lat != null) facts.push(`Pinned at ${esc(Number(facility.lat).toFixed(4))}, ${esc(Number(facility.lng).toFixed(4))}${facility.address ? ` (${esc(facility.address)})` : ''}.`);
  if (x.more) facts.push(esc(x.more));

  openModal(x.name, `
    <p style="margin-top:0;">${esc(x.what)}.</p>
    ${facts.length ? `<ul class="int-facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul>` : ''}
    <div class="section"><h3>${st.configured ? 'How it is set up' : 'How to set it up'}</h3>
      <ol class="int-steps">${x.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
      ${x.env.length ? `<p class="sub">backend/.env: ${x.env.map((k) => `<code>${esc(k)}</code>`).join(' ')}</p>` : ''}
    </div>
    ${x.key === 'googleCalendar' && st.active ? '<div class="section"><button class="btn" id="calSync" type="button">Sync upcoming bookings</button></div>' : ''}
    <div class="dlg-foot"><button class="btn" type="button" id="guideClose">Close</button></div>`);
  $('#guideClose').onclick = closeModal;

  const sync = $('#calSync');
  if (sync) sync.onclick = async () => {
    sync.disabled = true; sync.classList.add('is-busy');
    try {
      const r = await api('/integrations/calendar/sync', { method: 'POST', body: {} });
      const c = r.counts;
      toast(r.total
        ? `Calendar synced: ${c.created || 0} added, ${c.updated || 0} updated, ${c.removed || 0} removed${c.failed ? `, ${c.failed} failed` : ''}`
        : 'No upcoming bookings to sync', Boolean(c.failed));
    } catch (ex) { toast(ex.message, true); }
    sync.disabled = false; sync.classList.remove('is-busy');
  };
}

/* ---------- Custom API (webhook): the facility's own system gets signed booking events ----------
   The address, events and signing secret are saved through the same PIN + one-time code as the switches.
   A secret made by the server is shown once, right after saving; it is never sent back after that. */
const WH_STATE = {
  delivered: ['s-confirmed', 'Delivered'], failed: ['s-rejected', 'Failed'], pending: ['s-pending', 'Will retry'],
  sending: ['s-pending', 'Sending'], skipped: ['s-cancelled', 'Not sent'],
};
const WH_EXAMPLE = `const crypto = require('crypto');
// Express: keep the raw body, the signature covers the exact bytes
app.post('/makis-events', express.raw({ type: 'application/json' }), (req, res) => {
  const timestamp = req.get('X-Webhook-Timestamp');
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.MAKIS_WEBHOOK_SECRET)
    .update(timestamp + '.' + req.body).digest('hex');
  const given = req.get('X-Webhook-Signature') || '';
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300; // within 5 minutes
  if (!fresh || given.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.sendStatus(401);
  }
  const event = JSON.parse(req.body); // event.type, event.data.booking, event.data.changes
  res.sendStatus(200);                // any 2xx within 10 seconds counts as delivered
});`;

let redrawPending = false;
/** Redraw the Integrations page once, when the shared dialog next closes. */
function redrawIntegrationsOnClose() {
  if (redrawPending) return;
  redrawPending = true;
  dlg.addEventListener('close', () => { redrawPending = false; if (currentView === 'integrations') renderIntegrationsPage(); }, { once: true });
}

const hostOf = (url) => { try { return new URL(url).host; } catch (e) { return ''; } };
const prettyJson = (text) => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; } };
const bookingRefIn = (text) => { try { const j = JSON.parse(text); return (j.data && j.data.booking && j.data.booking.reference) || ''; } catch (e) { return ''; } };

function webhookLog(list, labels) {
  if (!list.length) return '<p class="sub">Nothing sent yet. Events show up here as bookings change. Try "Send test event".</p>';
  return `<div class="tablewrap"><table class="wh-log">
    <thead><tr><th>When</th><th>Event</th><th>Result</th><th class="r">Tries</th><th></th></tr></thead>
    <tbody>${list.map((x) => {
      const [cls, label] = WH_STATE[x.status] || ['', x.status];
      const result = x.status === 'delivered' ? `${label} · ${x.responseStatus}${x.durationMs != null ? ` · ${x.durationMs} ms` : ''}`
        : x.status === 'pending' && !x.attempts ? 'Queued'
          : x.status === 'pending' && x.nextAttemptAt ? `${label} ${fmtStamp(x.nextAttemptAt)}`
            : `${label}${x.responseStatus ? ` · ${x.responseStatus}` : ''}`;
      const ref = bookingRefIn(x.body);
      return `<tr>
        <td class="wh-when">${esc(fmtStamp(x.createdAt))}</td>
        <td>${esc(x.test ? 'Test event' : labels[x.type] || x.type)}${ref ? `<span class="sub wh-ref">${esc(ref)}</span>` : ''}</td>
        <td><span class="pill ${cls}">${esc(result)}</span>${x.error && x.status !== 'delivered' ? `<span class="sub">${esc(x.error)}</span>` : ''}</td>
        <td class="r">${esc(x.attempts)}</td>
        <td class="r wh-acts"><button type="button" class="btn small ghost" data-wh-view="${esc(x.id)}" aria-expanded="false">View</button>${
          x.status === 'failed' && !x.test ? `<button type="button" class="btn small" data-wh-retry="${esc(x.id)}">Send again</button>` : ''}</td>
      </tr>
      <tr class="wh-detail" data-wh-detail="${esc(x.id)}" hidden><td colspan="5">
        <span class="sub">Event <code>${esc(x.eventId)}</code>${x.responseBody ? ` · your system answered: <code>${esc(x.responseBody.slice(0, 200))}</code>` : ''}</span>
        <pre class="wh-code">${esc(prettyJson(x.body))}</pre>
      </td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function webhookHelp(retryMinutes) {
  const waits = (retryMinutes || []).map((m) => (m < 60 ? `${m} min` : `${m / 60} h`)).join(', ');
  return `<ul class="int-facts">
      <li>Each event is a <code>POST</code> with a JSON body: <code>id</code>, <code>type</code> (e.g. <code>booking.approved</code>), <code>createdAt</code>,
        <code>data.booking</code> (reference, court, date and times, fee, payment, customer) and <code>data.changes</code>, e.g. <code>{"status":{"from":"pending","to":"confirmed"}}</code>.</li>
      <li>Headers: <code>X-Webhook-Id</code> (the same on every retry, so repeats can be ignored), <code>X-Webhook-Event</code>, <code>X-Webhook-Timestamp</code> and <code>X-Webhook-Signature</code>.</li>
      <li>Answer with any 2xx status within 10 seconds. Anything else is tried again after ${esc(waits)}. Redirects are not followed.</li>
    </ul>
    <details class="wh-howto"><summary>Check the signature (Node.js example)</summary><pre class="wh-code">${esc(WH_EXAMPLE)}</pre></details>`;
}

/** Settings, test, recent events and help for the custom API, in the shared dialog. */
async function openWebhook() {
  let d;
  try { d = await api('/integrations/webhook'); } catch (ex) { return toast(ex.message, true); }
  const w = d.webhook;
  const labels = Object.fromEntries(d.events.map((e) => [e.type, e.label]));
  const chosen = new Set(w.url ? w.events : d.events.map((e) => e.type)); // a new setup starts with every event
  const host = hostOf(w.url);
  const kinds = (n) => (n === d.events.length ? 'every booking event' : `${n} kind${n === 1 ? '' : 's'} of booking event`);
  const [stateCls, stateText] = !w.url ? ['note', 'Not set up yet. Enter the address of your system, choose the events and save.']
    : w.secretSet && !w.secretReadable ? ['error', "The saved secret can't be read any more (JWT_SECRET in backend/.env changed), so nothing is sent. Make a new secret and save."]
      : !w.switchedOn ? ['note', `Off: nothing is sent to ${host}. Turn it on with its switch on the Integrations page.`]
        : ['ok', `On: sending ${kinds(w.events.length)} to ${host}.`];
  const radio = (value, label, checked, hint = '') => `<label class="check"><input type="radio" name="secretMode" value="${value}"${checked ? ' checked' : ''} />
    <span><b>${esc(label)}</b>${hint ? `<span class="sub">${hint}</span>` : ''}</span></label>`;

  redrawIntegrationsOnClose(); // the row shows what is saved after this dialog closes
  openModal('Custom API (webhook)', `
    <p style="margin-top:0;">Sends booking events to your own system as signed JSON: another booking app, a spreadsheet through
      Zapier, Make or n8n, or a lights or door controller at the courts.</p>
    <div class="msg ${stateCls}" style="margin:0 0 4px;">${esc(stateText)}</div>
    <form id="whForm" novalidate>
      ${field('Address of your system', `<input name="url" type="url" maxlength="500" placeholder="https://example.com/makis-events" value="${esc(w.url)}" autocomplete="off" />`,
        'Each event is POSTed here. Use an https address on the live server.')}
      <fieldset class="wh-events"><legend>Events to send</legend>
        ${d.events.map((e) => `<label class="check"><input type="checkbox" name="ev" value="${esc(e.type)}"${chosen.has(e.type) ? ' checked' : ''} />
          <span><b>${esc(e.label)}</b><code>${esc(e.type)}</code></span></label>`).join('')}
      </fieldset>
      <label class="check"><input type="checkbox" name="includeContact"${w.includeContact ? ' checked' : ''} />
        <span><b>Include customer contact details</b>Adds each customer's email and mobile number (their name is always sent). Turn this on only if your system needs them.</span></label>
      <fieldset class="wh-secret"><legend>Signing secret</legend>
        <p class="sub step-note">Your system uses it to check that each request really came from here (the <code>X-Webhook-Signature</code> header).</p>
        ${w.secretReadable ? radio('keep', `Keep the current one (ends in ${w.secretHint || '····'})`, true, w.secretSetAt ? `Saved ${esc(fmtStamp(w.secretSetAt))}` : '') : ''}
        ${radio('generate', w.secretReadable ? 'Make a new one' : 'Make one for me (recommended)', !w.secretReadable,
          `Shown once after saving, to copy into your system.${w.secretReadable ? ' The current one stops working.' : ''}`)}
        ${radio('custom', 'Use my own')}
        <input name="secret" type="password" autocomplete="off" maxlength="200" placeholder="16 to 200 characters, no spaces" aria-label="Your own secret" hidden />
      </fieldset>
      <p class="sub step-note" style="margin-top:14px;">Saving asks for your security PIN and a one-time code, like the on/off switches. Every admin is alerted.</p>
      <div class="msg error hidden" role="alert"></div>
      <div class="dlg-foot">
        ${w.url || w.secretSet ? '<button type="button" class="btn danger foot-left" id="whRemove">Remove</button>' : ''}
        ${w.url && w.secretReadable ? '<button type="button" class="btn" id="whTest">Send test event</button>' : ''}
        <button type="button" class="btn" data-close>Close</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>
    <div class="section"><h3>Recent events</h3><div id="whLog">${webhookLog(d.deliveries, labels)}</div></div>
    <div class="section"><h3>For your developer</h3>${webhookHelp(d.retryMinutes)}</div>`, { wide: true });

  const form = $('#whForm');
  const own = form.querySelector('[name=secret]');
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'secretMode') return;
    own.hidden = e.target.value !== 'custom';
    if (!own.hidden) own.focus();
  });

  const reloadLog = async () => {
    try {
      const n = await api('/integrations/webhook');
      if ($('#whLog')) $('#whLog').innerHTML = webhookLog(n.deliveries, labels);
    } catch (ex) { /* the toast already said how it went */ }
  };

  modalBody.onclick = async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    const view = e.target.closest('[data-wh-view]');
    if (view) {
      const row = modalBody.querySelector(`[data-wh-detail="${view.dataset.whView}"]`);
      if (row) { row.hidden = !row.hidden; view.setAttribute('aria-expanded', String(!row.hidden)); view.textContent = row.hidden ? 'View' : 'Hide'; }
      return;
    }
    const retry = e.target.closest('[data-wh-retry]');
    if (retry) {
      retry.disabled = true; retry.classList.add('is-busy');
      try {
        const r = await api(`/integrations/webhook/deliveries/${retry.dataset.whRetry}/retry`, { method: 'POST', body: {} });
        const x = r.delivery;
        toast(x.status === 'delivered' ? 'Sent again: delivered' : `Sent again: ${x.error || x.status}`, x.status !== 'delivered');
      } catch (ex) { toast(ex.message, true); }
      return reloadLog();
    }
  };

  const test = $('#whTest');
  if (test) test.onclick = async () => {
    test.disabled = true; test.classList.add('is-busy');
    try {
      const r = await api('/integrations/webhook/test', { method: 'POST', body: {} });
      const x = r.delivery;
      const ok = x && x.status === 'delivered';
      toast(ok ? `Test delivered: your system answered ${x.responseStatus} in ${x.durationMs} ms` : `Test not delivered: ${x ? x.error || x.status : 'not sent'}`, !ok);
      await reloadLog();
    } catch (ex) { toast(ex.message, true); }
    test.disabled = false; test.classList.remove('is-busy');
  };

  const remove = $('#whRemove');
  if (remove) remove.onclick = () => saveWebhook({ remove: true }, d.security);

  onSubmit(form, async (data) => {
    const url = String(data.url || '').trim();
    const events = [...form.querySelectorAll('input[name=ev]:checked')].map((c) => c.value);
    const secretMode = data.secretMode || 'generate';
    let parsed = null;
    try { parsed = new URL(url); } catch (ex) { /* checked below */ }
    if (!parsed || !['https:', 'http:'].includes(parsed.protocol)) throw new Error('Enter the full address of your system, starting with https://');
    if (!events.length) throw new Error('Choose at least one event to send.');
    if (secretMode === 'custom' && !/^\S{16,200}$/.test(data.secret || '')) throw new Error('Your own secret must be 16 to 200 characters, without spaces.');
    const same = url === w.url && Boolean(data.includeContact) === w.includeContact && secretMode === 'keep'
      && events.length === w.events.length && events.every((ev) => w.events.includes(ev));
    if (same) throw new Error('Nothing changed.');
    saveWebhook({ url, events, includeContact: Boolean(data.includeContact), secretMode, ...(secretMode === 'custom' ? { secret: data.secret } : {}) }, d.security);
  });
}

/** Saves the custom API settings (or removes them) after the PIN and one-time code. */
function saveWebhook(body, sec) {
  redrawIntegrationsOnClose();
  twoStepChange({
    what: body.remove ? 'Remove the custom API (webhook)' : `Send booking events to ${hostOf(body.url)}`,
    sec,
    start: (pin) => api('/integrations/webhook/verify', { method: 'POST', body: { ...body, pin } }),
    resend: (challengeId) => api('/integrations/webhook/verify/resend', { method: 'POST', body: { challengeId } }),
    confirm: (challengeId, otp) => api('/integrations/webhook', { method: 'PUT', body: { challengeId, otp } }),
    done: (res) => {
      const note = res.alertEmailed ? ' The admins were emailed about it.' : '';
      if (!res.secret) { toast(`${body.remove ? 'Custom API removed.' : 'Custom API saved.'}${note}`); return false; }
      showNewSecret(res.secret, note);
      return true;
    },
  });
}

/** A secret the server just made: shown this once, to copy into the receiving system. */
function showNewSecret(secret, note) {
  openModal('Copy your signing secret', `
    <p style="margin-top:0;">Saved.${esc(note)} Put this secret into your system now: it is <b>shown only this once</b>.</p>
    <div class="wh-secret-box"><code id="whSecret">${esc(secret)}</code><button type="button" class="btn small" id="whCopy">Copy</button></div>
    <p class="sub">Lost it? Open the custom API again and choose "Make a new one".</p>
    <div class="dlg-foot"><button type="button" class="btn primary" data-close>I've copied it</button></div>`);
  redrawIntegrationsOnClose();
  modalBody.onclick = async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (!e.target.closest('#whCopy')) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast('Secret copied');
    } catch (ex) { // no clipboard access (http): select it so Ctrl+C works
      const range = document.createRange();
      range.selectNodeContents($('#whSecret'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('Press Ctrl+C to copy the selected secret', true);
    }
  };
}

/* ---------- Reset to defaults: every switch back to its default (on); the custom API only when ticked ----------
   Keys in backend/.env are never touched, so a service without keys stays "Not set up". */
async function openResetIntegrations() {
  let p;
  try { p = await api('/integrations/reset'); } catch (ex) { return toast(ex.message, true); }
  const named = (on) => Object.keys(p.switches).filter((k) => p.switches[k] === on).map(intName);
  const steps = [];
  if (named(true).length) steps.push(`turn on ${andList(named(true))}`);
  if (named(false).length) steps.push(`turn off ${andList(named(false))}`);

  openModal('Reset integrations to defaults', `
    <p style="margin-top:0;">Puts every integration switch back to its default: on. Keys in backend/.env are not changed,
      so a service without its keys stays "Not set up".</p>
    ${steps.length
      ? `<ul class="int-facts">${steps.map((s) => `<li>${esc(s.charAt(0).toUpperCase() + s.slice(1))}.</li>`).join('')}</ul>`
      : '<div class="msg ok" style="margin:0 0 8px;">Every switch is already at its default.</div>'}
    ${p.webhookSet ? `<label class="check"><input type="checkbox" id="rsWebhook" />
      <span><b>Also remove the Custom API (webhook)</b>Deletes its address, chosen events and signing secret, so your own system stops getting booking events.</span></label>` : ''}
    <p class="sub step-note" style="margin-top:14px;">Resetting asks for your security PIN and a one-time code. Every admin is alerted.</p>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" id="rsGo">Reset</button></div>`);
  modalBody.onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(); };

  const alsoWebhook = $('#rsWebhook');
  const go = $('#rsGo');
  const sync = () => { go.disabled = !steps.length && !(alsoWebhook && alsoWebhook.checked); };
  if (alsoWebhook) alsoWebhook.onchange = sync;
  sync();
  go.onclick = () => {
    const removeWebhook = Boolean(alsoWebhook && alsoWebhook.checked);
    twoStepChange({
      what: `Reset integrations to defaults: ${andList([...steps, ...(removeWebhook ? ['remove the custom API (webhook)'] : [])])}`,
      sec: p.security,
      start: (pin) => api('/integrations/reset/verify', { method: 'POST', body: { pin, webhook: removeWebhook } }),
      resend: (challengeId) => api('/integrations/reset/verify/resend', { method: 'POST', body: { challengeId } }),
      confirm: (challengeId, otp) => api('/integrations/reset', { method: 'PUT', body: { challengeId, otp } }),
      done: (res) => {
        const n = Object.keys(res.changed || {}).length;
        const what = [n ? `${n} switch${n === 1 ? '' : 'es'} back to the default` : '', res.removedWebhook ? 'custom API removed' : ''].filter(Boolean).join(', ');
        toast(`Integrations reset${what ? `: ${what}` : ''}.${res.alertEmailed ? ' The admins were emailed about it.' : ''}`);
      },
      onClose: () => { if (currentView === 'integrations') renderIntegrationsPage(); },
    });
  };
}

/* =====================================================================
   API tokens: another system (a spreadsheet, a door panel at the courts, your own app) uses /api/v1 with a token
   instead of a password. The settings are checked before anything is saved, making one takes the PIN and a
   one-time code, and the token is shown once.
   ===================================================================== */
const TOKEN_STATUS = { active: ['s-confirmed', 'Active'], expired: ['s-rejected', 'Expired'], revoked: ['s-cancelled', 'Revoked'] };

async function renderApiTokens() {
  const d = await api('/api-tokens');
  setHead('API tokens', 'Let another system use the booking data with a token instead of a password',
    '<button class="btn primary" type="button" id="tkNew">New token</button>');
  const scopeLabel = Object.fromEntries(d.scopes.map((s) => [s.id, s.label]));
  const active = d.tokens.filter((t) => t.status === 'active').length;
  view.innerHTML = `
    <div class="card"><div class="tablewrap"><table class="tk-table">
      <thead><tr><th>Token</th><th>May</th><th>Rate limit</th><th>Status</th><th>Last used</th><th>Made by</th><th></th></tr></thead>
      <tbody>${d.tokens.length ? d.tokens.map((t) => {
        const [cls, label] = TOKEN_STATUS[t.status];
        const when = t.status === 'revoked' ? `${esc(fmtStamp(t.revokedAt))}${t.revokedByName ? ` by ${esc(t.revokedByName)}` : ''}`
          : t.expiresAt ? `${t.status === 'expired' ? 'expired' : 'expires'} ${esc(fmtDate(t.expiresAt))}` : 'never expires';
        return `<tr class="${t.status === 'active' ? '' : 'tk-off'}">
          <td><b>${esc(t.name)}</b><span class="sub"><code>${esc(t.prefix)}…</code></span></td>
          <td>${t.scopes.map((s) => `<span class="pill tk-scope">${esc(scopeLabel[s] || s)}</span>`).join(' ')}</td>
          <td>${esc(t.rateLimit.limit)} per ${esc(t.rateLimit.window)}</td>
          <td><span class="pill ${cls}">${label}</span><span class="sub">${when}</span></td>
          <td>${t.lastUsedAt ? `${esc(fmtStamp(t.lastUsedAt))}<span class="sub">${esc(t.lastUsedIp)}</span>` : '<span class="muted">Not used yet</span>'}</td>
          <td>${esc(t.createdByName)}<span class="sub">${esc(fmtDate(t.createdAt))}</span></td>
          <td class="r">${t.status === 'active' ? `<button type="button" class="btn small danger" data-revoke="${esc(t.id)}">Revoke</button>` : ''}</td>
        </tr>`;
      }).join('') : emptyRow(7, 'No API tokens yet. Make one so another system can read bookings or check customers in, without a password.')}</tbody>
    </table></div></div>
    <p class="sub tk-foot">${active} of ${esc(d.maxActive)} tokens in use. A token is shown once, when it is made: only its first characters are kept.</p>
    <div class="card" style="margin-top:12px;"><div class="pad">${apiHelp(d)}</div></div>`;
  $('#tkNew').onclick = () => newApiToken(d);
  view.onclick = (e) => {
    const b = e.target.closest('[data-revoke]');
    if (b) revokeApiToken(d.tokens.find((t) => t.id === b.dataset.revoke));
  };
  refreshView = renderApiTokens;
}

function apiHelp(d) {
  const rows = [
    ['GET', '/me', '', 'The token itself: name, permissions, rate limit, expiry'],
    ['GET', '/courts', 'courts:read', 'Courts, prices and opening hours'],
    ['GET', '/courts/{id}/availability?date=YYYY-MM-DD', 'courts:read', 'Free and taken times on a day'],
    ['GET', '/bookings?from=&to=&status=&court=&page=&limit=', 'bookings:read', 'Bookings (with customers:read: email and mobile too)'],
    ['GET', '/bookings/{reference}', 'bookings:read', 'One booking'],
    ['POST', '/check-ins  { "code": "MKI-…" }', 'checkins:write', 'Checks a customer in, by booking reference or QR code'],
  ];
  return `<h2 style="font-size:15px;margin:0 0 6px;">How another system uses it</h2>
    <p class="sub tk-note">Send the token with every request: <code>Authorization: Bearer mkp_…</code>. Answers are JSON.</p>
    <div class="tablewrap"><table class="tk-api"><thead><tr><th>Request</th><th>Needs</th><th>Gives</th></tr></thead><tbody>
      ${rows.map(([m, p, s, what]) => `<tr><td><code>${m} ${esc(d.baseUrl)}${esc(p)}</code></td>
        <td>${s ? `<code>${s}</code>` : '<span class="muted">any token</span>'}</td><td>${esc(what)}</td></tr>`).join('')}
    </tbody></table></div>
    <ul class="int-facts" style="margin-top:10px;">
      <li>Each token has its own rate limit. Every answer carries <code>RateLimit</code> headers; going over gives <code>429</code> with <code>Retry-After</code>.</li>
      <li>Refused: <code>401</code> TOKEN_MISSING, TOKEN_INVALID, TOKEN_REVOKED or TOKEN_EXPIRED; <code>403</code> TOKEN_SCOPE when the token may not do that.</li>
      <li>Bookings look the same as in the Custom API (webhook) events.</li>
    </ul>
    <pre class="wh-code">curl "${esc(d.baseUrl)}/bookings?from=${esc(todayStr())}" \\\n  -H "Authorization: Bearer mkp_…"</pre>`;
}

function newApiToken(d) {
  const windows = d.windows.map((w) => [w, `per ${w}`]);
  const expiry = [...d.expiryDays.map((n) => [String(n), n === 365 ? 'In a year' : `In ${n} days`]), ['date', 'On a date…'], ['never', 'Never (not recommended)']];
  openModal('New API token', `
    <form id="tkForm" novalidate>
      ${field('Name', '<input name="name" maxlength="60" placeholder="e.g. Door panel, Bookings sheet" autocomplete="off" />', 'So you can tell your tokens apart.')}
      <fieldset class="tk-scopes"><legend>What it may do</legend>
        ${d.scopes.map((s) => `<label class="check"><input type="checkbox" name="scope" value="${esc(s.id)}" />
          <span><b>${esc(s.label)}</b><code>${esc(s.id)}</code></span></label>`).join('')}
      </fieldset>
      <div class="row2">
        <label class="f">Rate limit<span class="tk-rate"><input name="limit" type="number" min="1" max="100000" value="60" aria-label="Requests" />
          <select name="window" aria-label="Per">${optionList(windows, 'minute')}</select></span>
          ${d.apiLimit ? `<small>At most ${esc(d.apiLimit.text)}: the limit for everyone.</small>` : ''}</label>
        <label class="f">Expires<select name="expires">${optionList(expiry, '90')}</select><input name="expiresDate" type="date" hidden aria-label="Expiry date" /></label>
      </div>
      <div class="msg error hidden" role="alert"></div>
      <p class="sub step-note" style="margin-top:12px;">Everything is checked first. Then you confirm with your security PIN and a one-time code, and the token is shown once.</p>
      <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Check and make token</button></div>
    </form>`, { wide: true });
  modalBody.onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(); };
  const form = $('#tkForm');
  const dateBox = form.querySelector('[name=expiresDate]');
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'expires') return;
    dateBox.hidden = e.target.value !== 'date';
    if (!dateBox.hidden) dateBox.focus();
  });
  setTimeout(() => form.querySelector('[name=name]').focus(), 30);

  onSubmit(form, async (data) => {
    const body = {
      name: data.name,
      scopes: [...form.querySelectorAll('input[name=scope]:checked')].map((c) => c.value),
      rateLimit: { limit: Number(data.limit), window: data.window },
      expires: data.expires === 'never' ? { never: true } : data.expires === 'date' ? { date: data.expiresDate } : { days: Number(data.expires) },
    };
    const c = await api('/api-tokens/check', { method: 'POST', body }); // validated before anything is saved
    if (!c.ok) {
      const box = form.querySelector('.msg');
      box.className = 'msg error';
      box.innerHTML = `<b>Fix ${c.problems.length === 1 ? 'this' : 'these'} first:</b><ul class="tk-problems">${c.problems.map((p) => `<li>${esc(p)}.</li>`).join('')}</ul>`;
      return;
    }
    twoStepChange({
      what: c.summary,
      sec: d.security,
      start: (pin) => api('/api-tokens/verify', { method: 'POST', body: { ...body, pin } }),
      resend: (challengeId) => api('/api-tokens/verify/resend', { method: 'POST', body: { challengeId } }),
      confirm: (challengeId, otp) => api('/api-tokens', { method: 'POST', body: { challengeId, otp } }),
      done: (res) => { showNewApiToken(res.token, res.apiToken, d.baseUrl); return true; },
      onClose: () => { if (currentView === 'tokens') renderApiTokens(); },
    });
  });
}

/** The new token, this once. */
function showNewApiToken(token, t, baseUrl) {
  openModal('Copy your API token', `
    <p style="margin-top:0;"><b>${esc(t.name)}</b> is ready. Copy the token now: it is <b>shown only this once</b>.</p>
    <div class="wh-secret-box"><code id="tkValue">${esc(token)}</code><button type="button" class="btn small" id="tkCopy">Copy</button></div>
    <p class="sub" style="margin-bottom:4px;">Try it:</p>
    <pre class="wh-code">curl ${esc(baseUrl)}/me \\\n  -H "Authorization: Bearer ${esc(token)}"</pre>
    <p class="sub">Lost it? Revoke it and make a new one.</p>
    <div class="dlg-foot"><button type="button" class="btn primary" data-close>I've copied it</button></div>`);
  modalBody.onclick = async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (!e.target.closest('#tkCopy')) return;
    try {
      await navigator.clipboard.writeText(token);
      toast('Token copied');
    } catch (ex) { // no clipboard access (http): select it so Ctrl+C works
      const range = document.createRange();
      range.selectNodeContents($('#tkValue'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('Press Ctrl+C to copy the selected token', true);
    }
  };
}

function revokeApiToken(t) {
  if (!t) return;
  openModal(`Revoke "${t.name}"?`, `
    <form id="rvForm">
      <p style="margin-top:0;">The system using <code>${esc(t.prefix)}…</code> gets "This API token was revoked" from now on.
        This can't be undone: make a new token if it needs access again.</p>
      <div class="msg error hidden" role="alert"></div>
      <div class="dlg-foot"><button type="button" class="btn" data-close>Keep it</button><button type="submit" class="btn solid-danger">Revoke token</button></div>
    </form>`);
  modalBody.onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(); };
  onSubmit($('#rvForm'), async () => {
    await api(`/api-tokens/${t.id}`, { method: 'DELETE' });
    toast(`"${t.name}" revoked. It stops working at once.`);
    closeModal();
    renderApiTokens();
  });
}

/* ---------- Weather (Open-Meteo) on the dashboard ---------- */
async function renderWeather() {
  const card = $('#weatherCard');
  if (!card) return;
  let d;
  try { d = await api('/integrations/weather'); } catch (e) { return; }
  if (!card.isConnected || d.off) return; // weather switched off under Integrations
  if (!d.weather) return;
  const approx = d.location && d.location.approximate;
  const w = d.weather;
  const today = todayStr();
  const nowHour = new Date(Date.now() + MANILA_MS).toISOString().slice(0, 13); // "YYYY-MM-DDTHH" in Manila
  const hours = w.hourly
    .filter((h) => h.time.slice(0, 10) === today && h.time.slice(0, 13) >= nowHour)
    .filter((h, idx) => idx % 2 === 0)
    .slice(0, 8);
  const wet = (p) => (p >= 60 ? 'color:var(--red);font-weight:600;' : p >= 30 ? 'color:var(--amber);font-weight:600;' : '');
  card.hidden = false;
  card.innerHTML = `
    <h2>Weather <span class="sub" style="font-weight:400;">${approx ? 'Metro Manila (approximate)' : esc(d.location ? d.location.label : '')}</span></h2>
    ${approx && can('settings') ? '<div class="msg note" style="margin:0 16px 4px;">Showing Metro Manila. <a href="#/location">Pin your facility</a> for an exact forecast and to show customers the map.</div>' : ''}
    <div class="pad" style="display:grid;gap:14px;">
      ${hours.length ? `<div style="display:flex;gap:8px;overflow-x:auto;">${hours.map((h) => `
        <div style="flex:0 0 auto;min-width:76px;text-align:center;border:1px solid var(--line);border-radius:8px;padding:8px 6px;">
          <div class="sub">${esc(h.time.slice(11, 16))}</div>
          <div class="num" style="font-size:16px;font-weight:600;">${h.temp}°</div>
          <div class="sub">${esc(h.summary)}</div>
          <div class="sub" style="${wet(h.rain)}">${h.rain}% rain</div>
        </div>`).join('')}</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;">${w.daily.map((x) => `
        <div style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;">
          <b>${x.date === today ? 'Today' : esc(fmtShort(x.date))}</b>
          <div class="sub">${esc(x.summary)}, ${x.min}–${x.max}°C</div>
          <div class="sub" style="${wet(x.rain)}">${x.rain}% chance of rain</div>
        </div>`).join('')}</div>
      <div class="sub">Forecast by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. Amber or red means rain is likely; consider warning customers with outdoor bookings.</div>
    </div>`;
}


/* =====================================================================
   AF-105 Customers / AF-106 Staff   (shared people table + form)
   ===================================================================== */
const PEOPLE_DEFAULTS = { q: '', active: '' };
const people = { customers: { ...PEOPLE_DEFAULTS }, staff: { ...PEOPLE_DEFAULTS } };

function renderCustomers(params) { return renderPeople('customers', params); }
function renderStaff(params) { return renderPeople('staff', params); }

async function renderPeople(kind, params) {
  const isStaff = kind === 'staff';
  const f = people[kind];
  const go = bindState(f, PEOPLE_DEFAULTS, params); // #/customers?q=juan&active=false
  setHead(isStaff ? 'Staff' : 'Customers',
    isStaff ? 'Staff and administrator accounts' : 'Customer accounts and booking history',
    `<button class="btn primary" id="addPerson" type="button">${isStaff ? 'Add staff member' : 'Add customer'}</button>`);
  $('#addPerson').onclick = () => personForm(kind, null);

  view.innerHTML = `
    <div class="bar">
      <input class="grow" id="uQ" type="search" placeholder="Search name, email or phone (press /)" value="${esc(f.q)}" aria-label="Search" />
      <select id="uActive" aria-label="Account status"><option value="">All accounts</option>
        <option value="true"${f.active === 'true' ? ' selected' : ''}>Active</option><option value="false"${f.active === 'false' ? ' selected' : ''}>Deactivated</option></select>
    </div>
    <div class="card" id="listCard"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i><i></i></div></div>`;

  let users = [];
  async function load() {
    const qs = new URLSearchParams({ type: kind });
    if (f.q) qs.set('q', f.q);
    if (f.active) qs.set('active', f.active);
    users = (await api(`/users?${qs}`)).users;
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>Name</th><th>Phone</th>${isStaff ? '<th>Role</th>' : '<th class="r">Bookings</th>'}<th>Joined</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.length ? users.map((u) => {
        const self = state.me && u.id === state.me.id;
        return `<tr>
          <td><b>${esc(u.firstName)} ${esc(u.lastName)}</b>${self ? ' <span class="muted">(you)</span>' : ''}<span class="sub">${esc(u.email)}</span></td>
          <td class="num">${esc(u.phone || '-')}</td>
          ${isStaff ? `<td>${pillR(u.role)}</td>` : `<td class="r num">${u.bookingCount}</td>`}
          <td>${esc(fmtDate(u.createdAt))}</td>
          <td>${pillA(u.isActive)}</td>
          <td class="r"><div class="btnrow" style="justify-content:flex-end;">
            <button class="btn small" data-act="edit" data-id="${esc(u.id)}">Edit</button>
            ${!isStaff ? `<button class="btn small" data-act="history" data-id="${esc(u.id)}">History</button>` : ''}
            ${self ? '' : `<button class="btn small ${u.isActive ? 'danger' : ''}" data-act="toggle" data-id="${esc(u.id)}">${u.isActive ? 'Deactivate' : 'Reactivate'}</button>`}
          </div></td></tr>`;
      }).join('') : emptyRow(6, f.q || f.active ? 'No accounts match these filters.' : `No ${isStaff ? 'staff' : 'customers'} yet.`)}</tbody></table></div>`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();

  const search = debounce(() => { f.q = $('#uQ').value.trim(); go(false); });
  view.oninput = (e) => { if (e.target.id === 'uQ') search(); };
  view.onchange = (e) => { if (e.target.id === 'uActive') { f.active = e.target.value; go(); } };
  view.onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const u = users.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === 'edit') personForm(kind, u);
    if (b.dataset.act === 'toggle') toggleActive(u);
    if (b.dataset.act === 'history') openHistory(u.id); // AF-124
  };
}

function personForm(kind, u) {
  const isNew = !u;
  const isStaff = kind === 'staff';
  const v = u || { firstName: '', lastName: '', email: '', phone: '' };
  openModal(isNew ? (isStaff ? 'Add staff member' : 'Add customer') : `Edit ${u.firstName} ${u.lastName}`, `
    <form id="personForm">
      <div class="row2">
        ${field('First name', `<input name="firstName" required value="${esc(v.firstName)}" />`)}
        ${field('Last name', `<input name="lastName" required value="${esc(v.lastName)}" />`)}
      </div>
      ${field('Email', `<input name="email" type="email" required value="${esc(v.email)}" autocomplete="off" />`)}
      ${field('Phone', `<input name="phone" type="tel" value="${esc(v.phone)}" />`)}
      ${isNew && isStaff ? field('Role', `<select name="role">${optionList([['staff', 'Staff - dashboard, bookings, walk-ins, court schedule'], ['admin', 'Admin - everything']], 'staff')}</select>`, 'You can change this later under Roles & access.') : ''}
      ${field(isNew ? 'Temporary password' : 'New password', `<input name="password" type="password" minlength="8" autocomplete="new-password" ${isNew ? 'required' : ''} />`,
        isNew ? 'At least 8 characters. Share it with them securely; they can change it from their profile.' : 'Leave blank to keep the current password. Setting one signs them out everywhere.')}
      <div class="dlg-foot"><button type="button" class="btn" id="pfCancel">Cancel</button><button type="submit" class="btn primary">${isNew ? 'Create account' : 'Save changes'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#pfCancel').onclick = closeModal;
  onSubmit($('#personForm'), async (data) => {
    if (!isNew && !data.password) delete data.password;
    if (isNew) data.role = isStaff ? (data.role || 'staff') : 'user';
    await api(isNew ? '/users' : `/users/${u.id}`, { method: isNew ? 'POST' : 'PUT', body: data });
    toast(isNew ? 'Account created' : 'Account updated');
    closeModal();
    refreshView();
  });
}

function toggleActive(u) {
  const off = u.isActive;
  openModal(off ? `Deactivate ${u.firstName}?` : `Reactivate ${u.firstName}?`, `
    <form id="actForm">
      <p>${off
        ? `<b>${esc(u.firstName)} ${esc(u.lastName)}</b> will be signed out right away and won't be able to log in. Their records and booking history stay.`
        : `<b>${esc(u.firstName)} ${esc(u.lastName)}</b> will be able to log in again.`}</p>
      <div class="dlg-foot"><button type="button" class="btn" id="acCancel">Cancel</button><button type="submit" class="btn ${off ? 'solid-danger' : 'primary'}">${off ? 'Deactivate account' : 'Reactivate account'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#acCancel').onclick = closeModal;
  onSubmit($('#actForm'), async () => {
    await api(`/users/${u.id}/active`, { method: 'PATCH', body: { isActive: !off }, version: u.writeTS });
    toast(off ? 'Account deactivated' : 'Account reactivated');
    closeModal();
    refreshView();
  });
}

/* =====================================================================
   AF-107  Roles & access
   ===================================================================== */
const rolesUi = { q: '' };

async function renderRoles(params) {
  const go = bindState(rolesUi, { q: '' }, params); // #/roles?q=ana
  setHead('Roles & access', 'Who can do what. A role decides which sections someone can open.');
  const info = await api('/roles');
  const feats = Object.entries(info.features);

  view.innerHTML = `
    <div class="card" style="margin-bottom:16px;"><div class="tablewrap"><table class="matrix">
      <thead><tr><th>Feature</th><th>Staff <span class="muted">(${info.counts.staff})</span></th><th>Admin <span class="muted">(${info.counts.admin})</span></th></tr></thead>
      <tbody>${feats.map(([key, label]) => `<tr><td>${esc(label)}</td>
        ${['staff', 'admin'].map((r) => `<td>${info.permissions[r].includes(key) ? '<span class="yes" aria-label="Allowed">&#10003;</span>' : '<span class="no" aria-label="Not allowed">&ndash;</span>'}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="pad muted" style="border-top:1px solid var(--line);">Customers (${info.counts.user}) have no admin access; they only use the public booking site.</div></div>

    <div class="bar"><input class="grow" id="rQ" type="search" placeholder="Find an account to change its role" value="${esc(rolesUi.q)}" aria-label="Search accounts" /></div>
    <div class="card" id="listCard"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i><i></i></div></div>`;

  let users = [];
  async function load() {
    const qs = new URLSearchParams({ type: 'all' });
    if (rolesUi.q) qs.set('q', rolesUi.q);
    users = (await api(`/users?${qs}`)).users;
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>Account</th><th>Status</th><th>Role</th></tr></thead>
      <tbody>${users.length ? users.map((u) => {
        const self = state.me && u.id === state.me.id;
        return `<tr><td><b>${esc(u.firstName)} ${esc(u.lastName)}</b>${self ? ' <span class="muted">(you)</span>' : ''}<span class="sub">${esc(u.email)}</span></td>
          <td>${pillA(u.isActive)}</td>
          <td><select data-id="${esc(u.id)}" aria-label="Role for ${esc(u.firstName)} ${esc(u.lastName)}" ${self ? 'disabled title="You can\'t change your own role"' : ''}>
            ${optionList(Object.entries(ROLE_LABEL), u.role)}</select></td></tr>`;
      }).join('') : emptyRow(3, 'No accounts match.')}</tbody></table></div>`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();

  const search = debounce(() => { rolesUi.q = $('#rQ').value.trim(); go(false); });
  view.oninput = (e) => { if (e.target.id === 'rQ') search(); };
  view.onchange = async (e) => {
    const sel = e.target.closest('select[data-id]');
    if (!sel) return;
    const u = users.find((x) => x.id === sel.dataset.id);
    try {
      await api(`/users/${u.id}/role`, { method: 'PATCH', body: { role: sel.value }, version: u.writeTS });
      toast(`${u.firstName} is now ${ROLE_LABEL[sel.value].toLowerCase()}`);
      renderRoles();
    } catch (err) { toast(err.message, true); refreshView(); }
  };
}

/* =====================================================================
   AF-103 Profile / AF-104 Change password
   ===================================================================== */
async function renderProfile() {
  setHead('My account', can('settings') ? 'Your details, password and security PIN' : 'Your details and password');
  const { user: me } = await api('/me');
  view.innerHTML = `
    <div class="grid2" style="grid-template-columns:1fr 1fr;">
      <div class="card"><div class="pad">
        <h2 style="font-size:15px;">Profile</h2>
        <form id="profForm">
          <div class="row2">
            ${field('First name', `<input name="firstName" required value="${esc(me.firstName)}" />`)}
            ${field('Last name', `<input name="lastName" required value="${esc(me.lastName)}" />`)}
          </div>
          ${field('Email', `<input value="${esc(me.email)}" disabled />`, 'Your email is your sign-in name. Ask another admin to change it.')}
          ${field('Phone', `<input name="phone" type="tel" value="${esc(me.phone || '')}" />`)}
          <p class="muted">Role: ${pillR(me.role)}</p>
          <div class="dlg-foot" style="justify-content:flex-start;"><button class="btn primary" type="submit">Save profile</button></div>
          <div class="msg error hidden" role="alert"></div>
        </form>
      </div></div>

      <div class="card"><div class="pad">
        <h2 style="font-size:15px;">Change password</h2>
        <form id="pwForm">
          ${field('Current password', '<input name="currentPassword" type="password" required autocomplete="current-password" />')}
          ${field('New password', '<input name="newPassword" type="password" required minlength="8" autocomplete="new-password" />', 'At least 8 characters.')}
          ${field('Confirm new password', '<input name="confirm" type="password" required minlength="8" autocomplete="new-password" />')}
          <div class="dlg-foot" style="justify-content:flex-start;"><button class="btn primary" type="submit">Change password</button></div>
          <div class="msg error hidden" role="alert"></div>
        </form>
      </div></div>

      ${can('settings') ? `<div class="card"><div class="pad">
        <h2 style="font-size:15px;">Security PIN</h2>
        <p class="sub step-note">${me.pinSet ? `Last set ${esc(fmtStamp(me.pinSetAt))}.` : '<b>Not created yet.</b>'}
          Asked for, together with a one-time code sent to your email, before sensitive changes: integrations, API tokens, and downloading, restoring or deleting backups.
          ${me.pinSet ? 'Forgot it? Set a new one here with your password.' : ''}</p>
        <form id="pinForm">
          ${field('Account password', '<input name="password" type="password" required autocomplete="current-password" />')}
          <div class="row2">${pinField('pin', me.pinSet ? 'New PIN' : 'PIN', '4 to 6 digits. Not 1234 or 0000.', 'new-password')}${pinField('confirm', 'Type it again', '', 'new-password')}</div>
          <div class="dlg-foot" style="justify-content:flex-start;"><button class="btn primary" type="submit">${me.pinSet ? 'Change PIN' : 'Create PIN'}</button></div>
          <div class="msg error hidden" role="alert"></div>
        </form>
      </div></div>` : ''}

      <div class="card" style="grid-column:1 / -1;"><div class="pad">
        <div class="row-between"><h2 style="font-size:15px;margin:0;">Where you're signed in</h2>
          <button class="btn small" id="endOthers" type="button" hidden>Sign out all other devices</button></div>
        <p class="sub" style="margin:4px 0 8px;">Sign out any device you don't recognise, then change your password.</p>
        <div id="mySessions"><div class="skeleton"><i></i><i></i></div></div>
      </div></div>
    </div>`;
  loadMySessions();

  onSubmit($('#profForm'), async (d) => {
    const r = await userApi('/profile', { method: 'PUT', body: { firstName: d.firstName, lastName: d.lastName, phone: d.phone } });
    state.me.firstName = r.user.firstName; state.me.lastName = r.user.lastName;
    paintMe();
    toast('Profile saved');
  });
  onSubmit($('#pwForm'), async (d) => {
    if (d.newPassword !== d.confirm) throw new Error('The new passwords do not match.');
    const r = await userApi('/change-password', { method: 'PUT', body: { currentPassword: d.currentPassword, newPassword: d.newPassword } });
    if (r.token) { // this device stays signed in with a new session; every other one was signed out
      localStorage.setItem(TOKEN_KEY, r.token);
      toast('Password changed. Your other devices were signed out.');
      $('#pwForm').reset();
      loadMySessions();
      return;
    }
    toast('Password changed. Please sign in again.');
    setTimeout(signOut, 1500);
  });
  if ($('#pinForm')) onSubmit($('#pinForm'), async (d) => {
    if (!PIN_RE.test(d.pin)) throw new Error('Use 4 to 6 digits for your PIN.');
    if (d.pin !== d.confirm) throw new Error('The two PINs do not match.');
    const r = await api('/security/pin', { method: 'PUT', body: { password: d.password, pin: d.pin } });
    state.me.pinSet = true;
    toast(r.message);
    renderProfile();
  });
}

/* =====================================================================
   Start
   ===================================================================== */
function paintMe() {
  $('#meName').textContent = `${state.me.firstName} ${state.me.lastName}`;
  $('#meRole').textContent = ROLE_LABEL[state.me.role] || state.me.role;
  // staff get the staff console: only the staff features in the menu (backend/config/permissions.js)
  const staffOnly = state.me.role === 'staff';
  const sub = document.querySelector('.brand-sub');
  if (sub) sub.textContent = staffOnly ? 'Staff console' : 'Admin console';
  document.title = `${staffOnly ? 'Staff' : 'Admin'} - MAKI's PickleBall Court`;
  // the avatar the person designed on the customer site (frontend/js/avatar.js); the default one until they do
  if (window.MakiAvatar && $('#meAv')) $('#meAv').innerHTML = MakiAvatar.svg(state.me.avatar, { size: 38 });
}

// mockup court photos (same set the customer site falls back to)
const COURT_PHOTOS = ['img/courts/court-1.jpg', 'img/courts/court-2.jpg', 'img/courts/court-3.jpg', 'img/courts/court-4.jpg', 'img/courts/court-5.jpg', 'img/courts/court-6.jpg'];
function courtPhoto(c) {
  const url = c && c.imageUrl ? String(c.imageUrl).trim() : '';
  if (url && /^(https?:\/\/|img\/|\/img\/)/i.test(url)) return url;
  const key = String((c && (c._id || c.name)) || '');
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return COURT_PHOTOS[h % COURT_PHOTOS.length];
}

// press "/" to jump to the search box on any list screen
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  const q = view.querySelector('input[type=search]');
  if (q) { e.preventDefault(); q.focus(); q.select(); }
});
/* ---------- notification bell: e.g. "Customer cancelled booking ..." ---------- */
const bellSeen = new Set();
let bellLoaded = false;
async function refreshBell() {
  try {
    const d = await request('/api/notifications');
    const n = d.unread || 0;
    // SF-127: a new alert pops up while staff work (not the ones already there when the console opened)
    const fresh = (d.notifications || []).filter((x) => !x.read && !bellSeen.has(x._id));
    (d.notifications || []).forEach((x) => bellSeen.add(x._id));
    if (bellLoaded && fresh.length) toast(`${fresh[0].message.slice(0, 160)}${fresh.length > 1 ? ` (and ${fresh.length - 1} more under My notifications)` : ''}`);
    if (fresh.length && currentView === 'alerts' && bellLoaded) refreshView(); // the page shows them at once
    bellLoaded = true;
    const c = $('#bellCount');
    c.textContent = n > 99 ? '99+' : n;
    c.classList.toggle('hidden', !n);
    $('#bellBtn').setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
    return d;
  } catch (e) { return null; }
}
(async function init() {
  if (!localStorage.getItem(TOKEN_KEY)) return signOut();
  try {
    const me = await api('/me');
    state.me = me.user;
    state.perms = me.permissions;
  } catch (err) {
    return signOut(); // not staff/admin, deactivated, or expired
  }
  paintMe();
  buildNav();
  wireMenu();
  updatePendingBadge();
  $('#bellBtn').onclick = () => { location.hash = '#/alerts'; }; // My notifications
  refreshBell();
  setInterval(refreshBell, 30 * 1000); // SF-127: check for new notifications every 30 seconds
  if (!location.hash) location.hash = '#/dashboard';
  route();
})();
