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
const custName = (b) => (b.user ? `${b.user.firstName} ${b.user.lastName}` : 'Deleted user');
const courtOf = (b) => (b.court && b.court.name) || b.courtName;

/* ---------- session + API ---------- */
const state = { me: null, perms: [] };
const can = (p) => state.perms.includes(p);

function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  location.replace('admin-login.html');
}

async function request(url, { method = 'GET', body } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { signOut(); throw new Error('Please sign in'); }
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (res.status === 401) { signOut(); throw new Error(data.message || 'Session expired'); }
  if (!res.ok || data.success === false) throw Object.assign(new Error(data.message || 'Something went wrong'), { status: res.status, data });
  return data;
}
const api = (path, opts) => request(`${window.API_ROOT || '/api'}/admin${path}`, opts);
const userApi = (path, opts) => request(`${window.API_ROOT || '/api'}/users${path}`, opts);

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
  schedule: { label: 'Schedule', perm: 'schedule', group: 'Operations', render: renderSchedule },
  courts: { label: 'Courts', perm: 'courts.view', group: 'Facility', render: renderCourts },
  settings: { label: 'Hours & rules', perm: 'settings', group: 'Facility', render: renderSettings },
  integrations: { label: 'Integrations', perm: 'settings', group: 'Facility', render: renderIntegrationsPage },
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
  ] },
  { label: 'Schedule', icon: 'schedule', route: 'schedule', perm: 'schedule', title: 'Schedule Management', kw: 'court schedule slots block unblock maintenance event conflicts calendar availability' },
  { label: 'Check-ins', icon: 'checkins', route: 'checkins', perm: 'checkins', title: 'Check-in Management', kw: 'arrive arrival check in check out checkout attendance today' },
  { group: 'courts', label: 'Courts', icon: 'courts', children: [
    { label: 'All courts', route: 'courts', href: '#/courts', q: {}, perm: 'courts.view', title: 'Court Management and Court Information', kw: 'add edit remove delete details name number location description facilities photo information' },
    { label: 'Status', route: 'courts', href: '#/courts?tab=status', q: { tab: 'status' }, perm: 'courts.status', title: 'Court Status Management', kw: 'available unavailable maintenance closed open' },
    { label: 'Pricing', route: 'courts', href: '#/courts?tab=pricing', q: { tab: 'pricing' }, perm: 'courts.pricing', title: 'Court Pricing Management', kw: 'price rate fee cost per hour peso' },
    { label: 'Opening hours', route: 'settings', href: '#/settings', q: {}, perm: 'settings', title: 'Operating Hours Management', kw: 'hours open close operating booking approval rules facility' },
    { label: 'Time slots', route: 'courts', href: '#/courts?tab=slots', q: { tab: 'slots' }, perm: 'courts.manage', title: 'Time Slot Management', kw: 'slot length duration minutes per court' },
  ] },
  { group: 'people', label: 'People', icon: 'staff', children: [
    { label: 'Customers', route: 'customers', perm: 'users', title: 'User Management', kw: 'users accounts add edit deactivate reactivate' },
    { label: 'Staff', route: 'staff', perm: 'staff', title: 'Staff Management', kw: 'employees accounts add deactivate team' },
    { label: 'Roles & access', route: 'roles', perm: 'roles', title: 'Role and Access Management', kw: 'roles permissions access admin staff assign' },
  ] },
  { group: 'care', label: 'Customer care', icon: 'care', children: [
    { label: 'Feedback', route: 'feedback', perm: 'feedback', title: 'Feedback Management', kw: 'ratings reviews stars comments' },
    { label: 'Issues', route: 'issues', perm: 'issues', title: 'Complaint and Issue Management', kw: 'complaints problems reports support reply' },
  ] },
  { group: 'comms', label: 'Messaging', icon: 'comms', children: [
    { label: 'Notifications', route: 'notifications', perm: 'notifications', title: 'Notifications Management', kw: 'send message alert broadcast customers' },
    { label: 'Announcements', route: 'announcements', perm: 'announcements', title: 'Announcements Management', kw: 'news post publish closure event' },
    { label: 'Promotions', route: 'promotions', perm: 'promotions', title: 'Promotions and Discounts', kw: 'discount promo code offer coupon special rate' },
  ] },
  { group: 'insights', label: 'Insights', icon: 'insights', children: [
    { label: 'Reports', route: 'reports', perm: 'reports', title: 'Reports', kw: 'generate print bookings users courts payments transactions' },
    { label: 'Booking analytics', route: 'analytics', href: '#/analytics?tab=bookings', q: { tab: 'bookings' }, perm: 'analytics', title: 'Booking Analytics', kw: 'trends peak hours popular courts cancellations' },
    { label: 'Revenue analytics', route: 'analytics', href: '#/analytics?tab=revenue', q: { tab: 'revenue' }, perm: 'analytics', title: 'Revenue Analytics', kw: 'income money earnings sales' },
    { label: 'User analytics', route: 'analytics', href: '#/analytics?tab=users', q: { tab: 'users' }, perm: 'analytics', title: 'User Analytics', kw: 'customers signups registered active repeat' },
  ] },
  { label: 'Integrations', icon: 'integrations', route: 'integrations', perm: 'settings', title: 'Integrations and API settings', kw: 'api google sign in calendar hitpay gcash qrph qr ph card grabpay shopeepay turnstile captcha map weather on off switch keys pin otp code two-step 2fa' },
  { label: 'Audit logs', icon: 'audit', route: 'audit', perm: 'audit', title: 'Audit Logs', kw: 'history activity log who changed monitoring security' },
  { label: 'My account', icon: 'profile', route: 'profile', perm: 'dashboard', title: 'Profile, password and security PIN', kw: 'profile password change name phone security pin' },
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
      const kids = item.children.filter((c) => can(c.perm));
      if (!kids.length) return '';
      const collapsed = navCollapsed.has(item.group);
      return `<div class="nav-group${collapsed ? ' collapsed' : ''}" data-group="${item.group}">
        <button type="button" class="nav-parent" aria-expanded="${!collapsed}" aria-controls="grp-${item.group}">
          ${svgIcon(item.icon)}<span class="label">${esc(item.label)}</span>${item.group === 'bookings' ? '<span class="pending-badge hidden"></span>' : ''}${CHEVRON}
        </button>
        <div class="nav-children" id="grp-${item.group}"><div>${kids.map((k) => leaf({ ...k, route: k.route }, 'nav-sub', item.label)).join('')}</div></div>
      </div>`;
    }
    return can(item.perm) ? leaf(item, 'nav-item') : '';
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
$('#logoutBtn').addEventListener('click', signOut);

/** Counts a number up from 0 so the dashboard feels alive; instant when motion is reduced. */
// Alerts for this staff account (e.g. a customer cancelled a booking), shown on the dashboard.
const notifApi = (path, opts) => request(`${window.API_ROOT || '/api'}/notifications${path}`, opts);
async function renderAlerts() {
  const card = document.getElementById('alertsCard');
  if (!card) return;
  let notifications = [];
  try { ({ notifications } = await notifApi('')); } catch (e) { return; }
  const unread = notifications.filter((n) => !n.read);
  const shown = [...unread, ...notifications.filter((n) => n.read)].slice(0, 8);
  if (!shown.length) return;
  card.hidden = false;
  document.getElementById('alertsReadAll').hidden = !unread.length;
  document.getElementById('alertsList').innerHTML = shown.map((n) => `
    <li style="gap:12px;align-items:flex-start;">
      <span style="${n.read ? 'color:var(--muted)' : 'font-weight:600'}">${esc(n.message)}</span>
      <span class="sub" style="white-space:nowrap;">${fmtDate(n.createdAt)}${n.read ? '' : ` <button class="btn" type="button" data-read="${esc(n._id)}" style="font-size:12px;padding:2px 8px;margin-left:6px;">Mark read</button>`}</span>
    </li>`).join('');
  card.onclick = async (e) => {
    const one = e.target.closest('[data-read]');
    const all = e.target.closest('#alertsReadAll');
    if (!one && !all) return;
    const ids = one ? [one.dataset.read] : unread.map((n) => n._id);
    await Promise.all(ids.map((id) => notifApi(`/${id}/read`, { method: 'PATCH' }).catch(() => {})));
    renderAlerts();
  };
}

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
  setHead(`${hello}, ${state.me.firstName}`, fmtLong(todayStr()));
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
      ${tile(can('schedule') ? '#/schedule' : '', '', "Today's bookings", d.todaysBookings, false, 'across all courts')}
      ${tile(can('payments') ? '#/payments?payment=paid' : '', '', 'Collected', d.revenue, true, `${d.paidCount} paid booking${d.paidCount === 1 ? '' : 's'}`)}
      ${tile(can('payments') ? '#/payments?payment=pending' : '', d.outstandingCount ? 'urgent' : '', 'Still to collect', d.outstanding, true, `${d.outstandingCount} unpaid booking${d.outstandingCount === 1 ? '' : 's'}`)}
    </div>

    <div class="card" id="weatherCard" hidden></div>

    <div class="card" id="alertsCard" hidden>
      <h2 style="display:flex;justify-content:space-between;align-items:center;gap:8px;">Alerts
        <button class="btn" id="alertsReadAll" type="button" style="font-size:12px;padding:4px 10px;">Mark all as read</button></h2>
      <ul class="facts" id="alertsList"></ul>
    </div>

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
          <li><span>Customers</span><b class="num">${d.totalCustomers}</b></li>
          <li><span>Staff and admins</span><b class="num">${d.totalStaff}</b></li>
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
  renderAlerts();
  renderWeather();
  refreshView = renderDashboard;
  view.onclick = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && can('bookings')) openBooking(tr.dataset.id);
  };
}

/* =====================================================================
   AF-115..AF-119  Bookings: list, details, approve/reject, cancel,
                   reschedule, status
   ===================================================================== */
const bk = { page: 1, status: '', payment: '', courtId: '', date: '', q: '' };

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
  setHead('Bookings', 'Every reservation, newest dates first');
  if (params.has('status') || params.has('payment') || params.has('q') || params.has('date')) {
    Object.assign(bk, { page: 1, status: params.get('status') || '', payment: params.get('payment') || '', q: params.get('q') || '', courtId: '', date: params.get('date') || '' });
  }
  const courts = can('courts.view') ? (await api('/courts')).courts : [];

  view.innerHTML = `
    <div class="bar">
      <input class="grow" id="fQ" type="search" placeholder="Search reference, customer name or email (press /)" value="${esc(bk.q)}" aria-label="Search bookings" />
      <select id="fStatus" aria-label="Booking status"><option value="">All statuses</option>${optionList(Object.entries(STATUS_LABEL), bk.status)}</select>
      <select id="fPay" aria-label="Payment status"><option value="">Any payment</option>${optionList(Object.entries(PAY_LABEL), bk.payment)}</select>
      <select id="fCourt" aria-label="Court"><option value="">All courts</option>${optionList(courts.map((c) => [c._id, c.name]), bk.courtId)}</select>
      <input id="fDate" type="date" value="${esc(bk.date)}" aria-label="Date" />
      <button class="btn" id="fClear" type="button">Clear</button>
    </div>
    <div class="card" id="listCard"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i><i></i></div></div>`;

  async function load() {
    const qs = new URLSearchParams({ page: bk.page, limit: 15 });
    ['status', 'payment', 'courtId', 'date', 'q'].forEach((k) => { if (bk[k]) qs.set(k, bk[k]); });
    const d = await api(`/bookings?${qs}`);
    if (d.page > d.pages) { bk.page = d.pages; return load(); }
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>Reference</th><th>Customer</th><th>Court</th><th>Date and time</th><th class="r">Fee</th><th>Status</th><th>Payment</th></tr></thead>
      <tbody>${bookingRows(d.bookings)}</tbody></table></div>${pager(d)}`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();

  const apply = () => { bk.page = 1; refreshView(); };
  const search = debounce(() => { bk.q = $('#fQ').value.trim(); apply(); });
  view.oninput = (e) => { if (e.target.id === 'fQ') search(); };
  view.onchange = (e) => {
    const map = { fStatus: 'status', fPay: 'payment', fCourt: 'courtId', fDate: 'date' };
    if (map[e.target.id]) { bk[map[e.target.id]] = e.target.value; apply(); }
  };
  view.onclick = (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { bk.page = Number(pg.dataset.page); return refreshView(); }
    if (e.target.closest('#fClear')) { Object.assign(bk, { page: 1, status: '', payment: '', courtId: '', date: '', q: '' }); return renderBookings(new URLSearchParams()); }
    const tr = e.target.closest('tr[data-id]');
    if (tr) openBooking(tr.dataset.id);
  };
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
    if (['pending', 'confirmed'].includes(st)) actions += '<button class="btn" data-act="resched">Reschedule...</button><button class="btn danger" data-act="ask" data-status="cancelled">Cancel booking...</button>';
    if (['cancelled', 'rejected'].includes(st)) actions += '<button class="btn" data-act="set" data-status="confirmed">Reinstate booking</button>';
    if (st === 'completed') actions += '<button class="btn" data-act="set" data-status="confirmed">Reopen as confirmed</button>';
  }

  let payActions = '';
  if (canP) {
    const ps = b.paymentStatus;
    if (['pending', 'failed'].includes(ps) && !['cancelled', 'rejected'].includes(st)) payActions += '<button class="btn primary small" data-act="pay" data-pay="paid">Mark paid</button>';
    if (ps === 'pending') payActions += '<button class="btn small" data-act="pay" data-pay="failed">Mark payment failed</button>';
    if (ps === 'paid') payActions += '<button class="btn small danger" data-act="pay" data-pay="refunded">Refund</button>';
    if (['paid', 'failed', 'refunded'].includes(ps)) payActions += '<button class="btn small" data-act="pay" data-pay="pending">Reset to unpaid</button>';
  }
  const methods = ['Cash', 'GCash', 'Maya', 'Card', 'Bank transfer', 'Other'];

  openModal(`Booking ${b.referenceNumber}`, `
    <dl class="kv">
      <dt>Customer</dt><dd>${esc(custName(b))}${b.user ? `<span class="sub muted"><br>${esc(b.user.email)}${b.user.phone ? ' &middot; ' + esc(b.user.phone) : ''}</span>` : ''}</dd>
      <dt>Court</dt><dd>${esc(courtOf(b))}${b.court && b.court.location ? `<span class="muted"> &middot; ${esc(b.court.location)}</span>` : ''}</dd>
      <dt>Date and time</dt><dd class="num">${fmtDate(b.date)}, ${esc(b.startTime)}–${esc(b.endTime)}</dd>
      <dt>Fee</dt><dd class="num">${peso(b.totalFee)}</dd>
      <dt>Booking status</dt><dd>${pillS(st)}${b.statusReason ? `<div class="muted" style="margin-top:4px;">Reason: ${esc(b.statusReason)}</div>` : ''}</dd>
      <dt>Payment</dt><dd>${pillP(b.paymentStatus)}${b.paymentMethod ? ` <span class="muted">via ${esc(b.paymentMethod)}</span>` : ''}${b.paidAt ? `<span class="muted"> on ${esc(fmtStamp(b.paidAt))}</span>` : ''}</dd>
      ${b.promoCode ? `<dt>Promo</dt><dd>${esc(b.promoCode)} <span class="muted">(−${peso(b.discount)})</span></dd>` : ''}
      ${b.paymentReference ? `<dt>Payment ref</dt><dd class="num">${esc(b.paymentReference)}${b.paymentStatus === 'pending' ? ' <span class="muted">awaiting verification</span>' : ''}${b.paymentNote ? `<div class="muted">Rejected: ${esc(b.paymentNote)}</div>` : ''}</dd>` : ''}
      ${b.refund && b.refund.at ? `<dt>Refund</dt><dd class="num">${peso(b.refund.amount)} <span class="muted">${esc(b.refund.reason || '')}</span></dd>` : ''}
      ${b.checkedInAt ? `<dt>Check-in</dt><dd>${esc(fmtStamp(b.checkedInAt))}${b.checkedOutAt ? ` <span class="muted">left ${esc(fmtStamp(b.checkedOutAt))}</span>` : ''}</dd>` : ''}
      <dt>Booked on</dt><dd>${esc(fmtStamp(b.createdAt))}</dd>
    </dl>

    ${actions ? `<div class="section"><h3>Booking</h3><div class="btnrow">${actions}</div></div>` : ''}

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
        <label class="f" style="margin:0;">Method<select id="payMethod">${optionList(methods.map((m) => [m, m]), b.paymentMethod || 'Cash')}</select></label>
        <div class="btnrow">${payActions}</div></div></div>` : ''}

    ${canP && !['cancelled', 'rejected'].includes(st) && (['pending', 'failed'].includes(b.paymentStatus) || (b.hitpay && b.hitpay.requestId)) ? `<div class="section"><h3>Online payment (HitPay)</h3>
      ${b.hitpay && b.hitpay.checkoutUrl ? `<p class="muted" style="margin:0 0 8px;">Link sent ${esc(fmtStamp(b.hitpay.createdAt))}: <a href="${esc(b.hitpay.checkoutUrl)}" target="_blank" rel="noopener">${esc(b.hitpay.checkoutUrl)}</a></p>` : '<p class="muted" style="margin:0 0 8px;">Send the customer a link to pay by GCash, QR Ph, card and more.</p>'}
      <div class="btnrow">
        ${['pending', 'failed'].includes(b.paymentStatus) ? `<button class="btn small" data-act="hpLink">${!(b.hitpay && b.hitpay.requestId) ? 'Send payment link' : b.hitpay.amount !== b.totalFee ? `Send new link for ${peso(b.totalFee)}` : 'Resend link'}</button>` : ''}
        ${b.hitpay && b.hitpay.requestId && ['pending', 'failed'].includes(b.paymentStatus) ? '<button class="btn small primary" data-act="hpCheck">Check payment</button>' : ''}
      </div></div>` : ''}

    <div id="bkErr" class="msg error hidden" role="alert"></div>`);

  const err = (t) => showErr($('#bkErr'), t);
  const hide = (id) => $(id).classList.add('hidden');
  const send = async (path, body, okText) => {
    $('#bkErr').className = 'msg error hidden';
    try {
      const r = await api(`/bookings/${b._id}${path}`, { method: 'PATCH', body });
      toast(okText);
      changed();
      showBooking(r.booking);
      return r;
    } catch (ex) { err(ex.message); return null; }
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
    } else if (act === 'hpLink' || act === 'hpCheck') {
      $('#bkErr').className = 'msg error hidden';
      btn.disabled = true;
      try {
        if (act === 'hpLink') {
          await api(`/bookings/${b._id}/hitpay-link`, { method: 'POST', body: {} });
          toast('Payment link sent to the customer');
        } else {
          const r = await api(`/bookings/${b._id}/hitpay-check`, { method: 'POST', body: {} });
          toast(r.paid ? 'Paid via HitPay - payment recorded' : (r.message || 'Not paid yet'), Boolean(r.message));
          if (r.paid) changed();
        }
        showBooking((await api(`/bookings/${b._id}`)).booking);
      } catch (ex) { err(ex.message); btn.disabled = false; }
    } else if (act === 'pay') {
      const to = btn.dataset.pay;
      const body = { paymentStatus: to };
      if (to === 'paid') body.paymentMethod = $('#payMethod').value;
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
      ? `${r.court.name} is currently ${r.court.status}, so it can't take bookings.`
      : 'Only open slots are listed. The customer is notified of the change.';
  } catch (ex) { showErr($('#bkErr'), ex.message); }
}

/* =====================================================================
   AF-120  Payments
   ===================================================================== */
const pay = { page: 1, payment: 'pending', q: '' };

async function renderPayments(params) {
  setHead('Payments', 'Confirm what customers have paid at the facility');
  if (params.has('payment')) { pay.payment = params.get('payment'); pay.page = 1; }
  const { summary: s } = await api('/payments/summary');

  const stat = (label, key, sub) => `<a href="#/payments?payment=${key}" class="${pay.payment === key ? '' : ''}"><div class="k">${label}</div><div class="v num">${peso(s[key].amount)}</div><div class="s">${s[key].count} ${sub}</div></a>`;
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
    if (d.page > d.pages) { pay.page = d.pages; return load(); }
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
          <td>${pillP(b.paymentStatus)}${b.paymentMethod ? `<span class="sub">${esc(b.paymentMethod)}</span>` : ''}</td>
          <td class="r">${btns.join(' ')}</td></tr>`;
      }).join('') : emptyRow(6, 'No payments match. Try another status.')}</tbody></table></div>${pager(d)}`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();

  const search = debounce(() => { pay.q = $('#pQ').value.trim(); pay.page = 1; refreshView(); });
  view.oninput = (e) => { if (e.target.id === 'pQ') search(); };
  view.onchange = (e) => { if (e.target.id === 'pStatus') { pay.payment = e.target.value; pay.page = 1; refreshView(); } };
  view.onclick = (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { pay.page = Number(pg.dataset.page); return refreshView(); }
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
      ${refund ? '' : field('Paid by', `<select name="paymentMethod">${optionList(['Cash', 'GCash', 'Maya', 'Card', 'Bank transfer', 'Other'].map((m) => [m, m]), 'Cash')}</select>`)}
      <div class="dlg-foot"><button type="button" class="btn" id="payCancel">Cancel</button><button type="submit" class="btn ${refund ? 'solid-danger' : 'primary'}">${refund ? 'Mark refunded' : 'Record payment'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#payCancel').onclick = closeModal;
  onSubmit($('#payForm'), async (data) => {
    await api(`/bookings/${b._id}/payment`, { method: 'PATCH', body: { paymentStatus: refund ? 'refunded' : 'paid', paymentMethod: data.paymentMethod } });
    toast(refund ? 'Marked as refunded' : 'Payment recorded');
    closeModal();
    // summary tiles changed too, so redraw the whole view
    renderPayments(new URLSearchParams());
    updatePendingBadge();
  });
}

/* =====================================================================
   AF-113 / AF-114  Schedule: slot board, block and unblock slots
   ===================================================================== */
const sched = { courtId: '', date: '' };

async function renderSchedule() {
  const { courts } = await api('/courts');
  if (!courts.length) {
    setHead('Schedule', 'Court availability by day');
    view.innerHTML = '<div class="card"><div class="empty">There are no courts yet. Add one under Courts first.</div></div>';
    return;
  }
  if (!courts.some((c) => c._id === sched.courtId)) sched.courtId = courts[0]._id;
  if (!sched.date) sched.date = todayStr();
  setHead('Schedule', 'Block slots for maintenance or events; open ones stay bookable');

  view.innerHTML = `
    <div class="bar">
      <select id="sCourt" aria-label="Court">${optionList(courts.map((c) => [c._id, `${c.name}${c.status !== 'available' ? ` (${c.status})` : ''}`]), sched.courtId)}</select>
      <button class="btn" id="sPrev" type="button" aria-label="Previous day">&larr;</button>
      <input type="date" id="sDate" value="${esc(sched.date)}" aria-label="Date" />
      <button class="btn" id="sNext" type="button" aria-label="Next day">&rarr;</button>
      <button class="btn" id="sToday" type="button">Today</button>
      <span style="flex:1"></span>
      <button class="btn danger" id="sBlockDay" type="button">Block the whole day</button>
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

  const go = (date) => { sched.date = date; $('#sDate').value = date; refreshView(); };
  view.onchange = (e) => {
    if (e.target.id === 'sCourt') { sched.courtId = e.target.value; refreshView(); }
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
    else if (s.status === 'blocked') unblockDialog(s);
    else if (s.status === 'available') blockDialog(data, s);
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
      <div class="dlg-foot"><button type="button" class="btn" id="blkCancel">Cancel</button><button type="submit" class="btn primary">${allDay ? 'Block all open slots' : 'Block slot'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#blkCancel').onclick = closeModal;
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
  setHead(INFO[tab][0], INFO[tab][1], tab === 'all' && can('courts.manage') ? '<button class="btn primary" id="addCourt" type="button">Add court</button>' : '');
  if (tab === 'all' && can('courts.manage')) $('#addCourt').onclick = () => courtForm(null);

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
          <td><b>${esc(c.name)}</b><span class="sub">${esc(c.courtNumber || '')}${c.facilities && c.facilities.length ? (c.courtNumber ? ' &middot; ' : '') + esc(c.facilities.join(', ')) : ''}</span></td>
          <td>${esc(c.location)}</td>
          <td class="r num">${peso(c.pricePerHour)}</td>
          <td class="num">${esc(c.openTime)}–${esc(c.closeTime)}<span class="sub">${c.slotDurationMinutes}-minute slots</span></td>
          <td>${can('courts.status') ? `<select data-act="status" data-id="${esc(c._id)}" aria-label="Status of ${esc(c.name)}">${optionList(['available', 'unavailable', 'maintenance', 'closed'].map((s) => [s, s]), c.status)}</select>` : pillC(c.status)}</td>
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
        <td>${name(c)}</td><td>${pillC(c.status)}</td>
        <td><select data-act="status" data-id="${esc(c._id)}" aria-label="Status of ${esc(c.name)}">${optionList(['available', 'unavailable', 'maintenance', 'closed'].map((s) => [s, s]), c.status)}</select></td>
        <td class="r num">${c.upcomingBookings}</td></tr>`).join('') : emptyRow(4, 'No courts yet.')}</tbody></table></div>
      <div class="pad note">Customers can only book courts marked <b>available</b>. Setting a court to maintenance or closed keeps its existing bookings, so review them under Bookings.</div>`,

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
      const r = await api(`/courts/${sel.dataset.id}/status`, { method: 'PATCH', body: { status: sel.value } });
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
          await api(`/courts/${c._id}/price`, { method: 'PATCH', body: { pricePerHour: Number(row.querySelector('[name=price]').value) } });
          toast(`Price for ${c.name} updated`);
        } else {
          await api(`/courts/${c._id}`, { method: 'PUT', body: { openTime: row.querySelector('[name=open]').value, closeTime: row.querySelector('[name=close]').value, slotDurationMinutes: Number(row.querySelector('[name=step]').value) } });
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
      ${field('Photo link', `<input name="imageUrl" type="url" value="${esc(v.imageUrl)}" placeholder="https://..." />`)}
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
  onSubmit($('#courtForm'), async (data) => {
    data.slotDurationMinutes = Number(data.slotDurationMinutes);
    await api(isNew ? '/courts' : `/courts/${c._id}`, { method: isNew ? 'POST' : 'PUT', body: data });
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
    await api(`/courts/${c._id}/price`, { method: 'PATCH', body: { pricePerHour: Number(data.pricePerHour) } });
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
    await api(`/courts/${c._id}`, { method: 'DELETE' });
    toast('Court removed');
    closeModal();
    refreshView();
  });
}

/* =====================================================================
   AF-112  Hours & booking rules
   ===================================================================== */
async function renderSettings() {
  setHead('Hours & rules', 'Facility-wide opening hours, location and how bookings are accepted');
  const { settings: s } = await api('/settings');
  const hasPin = s.facilityLat != null && s.facilityLng != null;
  view.innerHTML = `
    <div class="card" style="max-width:640px;"><div class="pad">
      <form id="setForm">
        <h2 style="font-size:15px;">Opening hours</h2>
        <div class="row2">
          ${field('Opens', `<input name="openTime" type="time" required value="${esc(s.openTime)}" />`)}
          ${field('Closes', `<input name="closeTime" type="time" required value="${esc(s.closeTime)}" />`)}
        </div>
        <label class="check"><input type="checkbox" name="applyToCourts" />
          <span><b>Also apply to every court now</b>New courts always start with these hours. Turn this on to change the courts you already have. It is refused if an upcoming booking would fall outside the new hours.</span></label>

        <h2 style="font-size:15px;margin-top:24px;">Facility location</h2>
        <p class="sub" style="margin:4px 0 8px;">Customers see this pin on a "Find us" map with directions, and the weather forecast uses it. Search for the address, use your current location, or click the map.</p>
        <div id="facStatus" class="msg ${hasPin ? 'ok' : 'note'}" style="margin:0 0 8px;">${hasPin
          ? 'Pinned. Customers see the map and the forecast is for this spot.'
          : 'Not pinned yet: customers can\'t see the map, and the weather uses Metro Manila until you pin it.'}</div>
        <div class="fac-search">
          <input id="facQuery" type="search" placeholder="Search an address, e.g. Rizal Park, Manila" aria-label="Search an address" />
          <button class="btn" type="button" id="facFind">Search</button>
          <button class="btn" type="button" id="facHere">Use my current location</button>
        </div>
        <ul id="facResults" class="fac-results" hidden></ul>
        <div id="facMap" style="height:300px;border-radius:8px;border:1px solid var(--line);background:#eef3f9;"></div>
        <div class="row2" style="margin-top:8px;">
          ${field('Latitude', `<input name="facilityLat" id="facLat" inputmode="decimal" value="${hasPin ? esc(s.facilityLat) : ''}" placeholder="e.g. 14.5995" />`)}
          ${field('Longitude', `<input name="facilityLng" id="facLng" inputmode="decimal" value="${hasPin ? esc(s.facilityLng) : ''}" placeholder="e.g. 120.9842" />`)}
        </div>
        ${field('Address (optional)', `<input name="facilityAddress" maxlength="200" value="${esc(s.facilityAddress || '')}" placeholder="Street, city" />`)}

        <h2 style="font-size:15px;margin-top:24px;">Booking approval</h2>
        <p class="sub" style="margin:4px 0 0;">Every new booking waits as "Pending approval" and holds its slot until staff approve or reject it under <a href="#/bookings?status=pending">Waiting for approval</a>. A customer who reschedules goes back to pending too.</p>

        <div class="dlg-foot" style="justify-content:flex-start;"><button class="btn primary" type="submit">Save settings</button></div>
        <div class="msg error hidden" role="alert"></div>
      </form>
    </div></div>
    <div class="card" style="max-width:640px;"><div class="pad" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <span><b>Integrations</b><span class="sub" style="display:block;">Google, HitPay, Turnstile, map and weather: turn them on or off and see how to set them up.</span></span>
      <a class="btn" href="#/integrations">Manage integrations</a></div></div>`;
  const form = $('#setForm');
  facMovePin = null;
  addressTouched = Boolean(s.facilityAddress);
  wireFacilitySearch();
  api('/integrations').then((r) => r.integrations).catch(() => null).then((i) => {
    if (!$('#facMap')) return;
    if (i && !i.maps.active) {
      $('#facMap').outerHTML = '<p class="sub" id="facMap">The map is turned off under <a href="#/integrations">Integrations</a>. You can still type the latitude and longitude.</p>';
    } else initFacilityMap(hasPin ? [s.facilityLat, s.facilityLng] : null);
  });
  onSubmit(form, async (data) => {
    const r = await api('/settings', { method: 'PUT', body: {
      openTime: data.openTime, closeTime: data.closeTime, applyToCourts: data.applyToCourts,
      facilityLat: data.facilityLat.trim(), facilityLng: data.facilityLng.trim(), facilityAddress: data.facilityAddress,
    } });
    toast(r.updatedCourts ? `Saved. Hours updated on ${r.updatedCourts} court${r.updatedCourts === 1 ? '' : 's'}.` : 'Settings saved');
    const pinned = r.settings && r.settings.facilityLat != null;
    const st = $('#facStatus');
    if (st) {
      st.className = `msg ${pinned ? 'ok' : 'note'}`;
      st.textContent = pinned ? 'Pinned. Customers see the map and the forecast is for this spot.'
        : "Not pinned yet: customers can't see the map, and the weather uses Metro Manila until you pin it.";
    }
    form.querySelector('[name=applyToCourts]').checked = false;
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
  st.textContent = 'Pin moved. Press "Save settings" to keep it.';
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
  hitpay: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  googleCalendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  maps: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  weather: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sms: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  qrCheckin: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
};

const INTEGRATIONS = [
  {
    key: 'googleSignIn', name: 'Google Sign-In', group: 'Sign-in',
    what: 'Customers and staff sign in with Google',
    env: ['GOOGLE_CLIENT_ID'],
    steps: [
      'Google Cloud Console → APIs & Services → Credentials → create an OAuth client ID ("Web application").',
      'Add your site (e.g. http://localhost:5000) under "Authorized JavaScript origins".',
      'Put the client ID in <code>GOOGLE_CLIENT_ID</code> and restart the server.',
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
    key: 'hitpay', name: 'HitPay', group: 'Payments',
    what: 'Customers pay online by GCash, QR Ph, card and more',
    env: ['HITPAY_API_KEY', 'HITPAY_SANDBOX', 'HITPAY_WEBHOOK_SALT'],
    steps: [
      'Sign up at hitpayapp.com. While testing, use a sandbox account (dashboard.sandbox.hit-pay.com).',
      'HitPay dashboard → Settings → API Keys. Copy the API key into <code>HITPAY_API_KEY</code>. Keep <code>HITPAY_SANDBOX=true</code> for sandbox keys; set it to <code>false</code> with live keys.',
      'For automatic "paid" updates: Developers → Webhook Endpoints, add <code>https://&lt;your-site&gt;/api/webhooks/hitpay</code> for the event <code>payment_request.completed</code>, and put that endpoint\'s salt in <code>HITPAY_WEBHOOK_SALT</code>. HitPay needs a public https address, so this doesn\'t work on localhost.',
      'Restart the server, open a booking and press "Send payment link".',
    ],
    more: 'Customers get a "Pay online now" button on their booking and pay with any method switched on in your HitPay account. After paying they come back to their booking, which then shows the payment. Staff can also send a link from a booking. Turning it off stops new links. Payments already made on a link are still recorded.',
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
    steps: ['Nothing to set up. Pin the facility under <a href="#/settings">Opening hours</a>.'],
  },
  {
    key: 'weather', name: 'Weather', group: 'Facility',
    what: 'Rain forecast for staff and for customers picking a date',
    env: [],
    steps: ['Nothing to set up. It uses the facility pinned under <a href="#/settings">Opening hours</a>.'],
  },
  {
    key: 'sms', name: 'SMS (Semaphore)', group: 'Messaging',
    what: 'Text customers booking updates and reminders',
    env: ['SEMAPHORE_API_KEY', 'SEMAPHORE_SENDER_NAME'],
    steps: [
      'Sign up at semaphore.co and buy credits (about ₱0.50 per text).',
      'Copy your API key into <code>SEMAPHORE_API_KEY</code>.',
      'Optional: register a sender name (e.g. MAKISPB) with Semaphore and put it in <code>SEMAPHORE_SENDER_NAME</code>.',
      'Restart the server.',
    ],
    more: 'Sent for: booking received, approved or not approved, cancelled by the facility, moved, payment received, refund, expired and the 2-hour reminder. Only to customers with a PH mobile number on their profile who have not turned texts off. Admin one-time codes also go to an admin\'s mobile (from My account) whenever SMS is set up, even if this switch is off.',
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
    more: 'Same updates as SMS; the approval email includes a calendar file with a 2-hour reminder. Password resets, admin one-time codes and integration change alerts are always sent when email is set up, even if this switch is off.',
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
];

/** One short line that needs the admin's attention, or ''. */
function integrationNote(x, st, facility) {
  if (!st.active) return '';
  if (x.key === 'hitpay') return [st.sandbox ? 'Sandbox: test payments only' : '', !st.webhook ? 'no webhook: payments show when the customer comes back, or press "Check payment"' : '']
    .filter(Boolean).join(' · ').replace(/^./, (c) => c.toUpperCase());
  if (x.key === 'weather' && facility.lat == null) return 'Using Metro Manila until you <a href="#/settings">pin the facility</a>';
  if (x.key === 'maps' && facility.lat == null) return 'Not pinned yet: customers can\'t see the map. <a href="#/settings">Pin the facility</a>';
  return '';
}

async function renderIntegrationsPage() {
  const d = await api('/integrations');
  // A service the server doesn't report means the server is running older code than this page:
  // show it as "restart needed" instead of failing.
  const i = { ...d.integrations };
  const unknown = INTEGRATIONS.filter((x) => !i[x.key]).map((x) => x.name);
  INTEGRATIONS.forEach((x) => { if (!i[x.key]) i[x.key] = { configured: false, switchedOn: false, active: false, unknown: true }; });
  const running = INTEGRATIONS.filter((x) => i[x.key].active).length;
  const sec = d.security; // missing when the server runs older code
  setHead('Integrations', `${running} of ${INTEGRATIONS.length} running · turning one on or off asks for your PIN and a one-time code`);

  const status = (st) => (st.unknown ? ['none', 'Restart needed'] : st.active ? ['on', 'On'] : st.configured ? ['off', 'Off'] : ['none', 'Not set up']);
  const row = (x) => {
    const st = i[x.key];
    const [cls, label] = status(st);
    const note = integrationNote(x, st, d.facility);
    return `<li class="int-row" data-key="${x.key}">
      <span class="int-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${INT_ICON[x.key]}</svg></span>
      <span class="int-main">
        <b>${esc(x.name)}</b>
        <span class="int-what">${esc(x.what)}</span>
        ${note ? `<span class="int-warn">${note}</span>` : ''}
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
    <div class="card int-list">${groups.map((g) => `
      <h2 class="int-group">${esc(g)}</h2>
      <ul>${INTEGRATIONS.filter((x) => x.group === g).map(row).join('')}</ul>`).join('')}
    </div>
    ${sec && !sec.canSendCodes ? `<div class="msg error int-foot" role="status">Integrations can't be turned on or off until email is set up:
      the one-time codes are sent by email. See <b>Email</b> above.</div>` : ''}
    ${sec && sec.viaConsole ? `<div class="msg note int-foot" role="status">Email is not set up on this server, so one-time codes are printed in the
      <b>server console</b> (development only). Set up <b>Email</b> above to get them by email.</div>` : ''}
    <p class="sub int-foot">Keys stay in backend/.env on the server and are never shown here.
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
    if (b) integrationGuide(INTEGRATIONS.find((x) => x.key === b.dataset.guide), i[b.dataset.guide], d.facility);
  };
  refreshView = renderIntegrationsPage;
}

/* ---------- Two-step check before an integration is turned on or off ----------
   1. the admin's security PIN (created here the first time, or under My account), then
   2. a 6-digit code the server sends to the admin's email (and phone, when SMS is set up).
   The server keeps the change with the code, so the code approves exactly this change. */
const PIN_RE = /^\d{4,6}$/;
const pinField = (name, label, hint = '', ac = 'off') => field(label,
  `<input name="${name}" type="password" inputmode="numeric" pattern="[0-9]{4,6}" minlength="4" maxlength="6" title="4 to 6 digits" required autocomplete="${ac}" />`, hint);
const intName = (key) => (INTEGRATIONS.find((x) => x.key === key) || { name: key }).name;
const andList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');

function changeIntegrations(switches, sec) {
  const what = andList(Object.entries(switches).map(([k, on]) => `turn ${on ? 'on' : 'off'} ${intName(k)}`)).replace(/^./, (c) => c.toUpperCase());
  let closed = false;
  // closing the dialog at any step (Cancel, Esc, done) redraws the page, so every switch shows what is saved
  dlg.addEventListener('close', () => { closed = true; if (currentView === 'integrations') renderIntegrationsPage(); }, { once: true });

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

    const resend = $('#otpResend');
    if (resend) {
      let wait = r.resendIn || 30;
      const paint = () => { resend.disabled = wait > 0; resend.textContent = wait > 0 ? `New code in ${wait}s` : 'Send a new code'; };
      paint();
      const timer = setInterval(() => {
        if (closed || !resend.isConnected) return clearInterval(timer);
        if (wait > 0) { wait -= 1; paint(); }
      }, 1000);
      resend.onclick = async () => {
        resend.disabled = true; resend.classList.add('is-busy');
        try {
          const n = await api('/integrations/verify/resend', { method: 'POST', body: { challengeId } });
          $('#codeWhere').innerHTML = whereText(n);
          toast('New code sent. The old one no longer works.');
          if (n.resendsLeft <= 0) { clearInterval(timer); resend.remove(); return; }
          wait = n.resendIn || 30;
        } catch (ex) { showErr($('#codeStep .msg'), ex.message); }
        resend.classList.remove('is-busy');
        paint();
      };
    }

    onSubmit($('#codeStep'), async (d) => {
      const otp = String(d.otp || '').replace(/\D/g, '');
      if (otp.length !== 6) throw new Error('Enter the 6-digit code.');
      const res = await api('/integrations', { method: 'PUT', body: { challengeId, otp } });
      const done = Object.entries(res.changed).map(([k, on]) => `${intName(k)} ${on ? 'on' : 'off'}`).join(', ');
      toast(`${done}${res.alertEmailed ? '. The admins were emailed about it.' : ''}`);
      if (!closed) closeModal(); // the close handler redraws the page
      else if (currentView === 'integrations') renderIntegrationsPage();
    });
  };

  const sendCode = (pin) => api('/integrations/verify', { method: 'POST', body: { switches, pin } });

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
    show('Create your security PIN', `${head(1)}Turning integrations on or off takes two checks: a security PIN that only you know,
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
    show('Set up email first', `<p style="margin-top:0;">Turning integrations on or off needs a one-time code sent to your email, but email is not set up on the server.</p>
      <p class="sub">Add <code>RESEND_API_KEY</code> (or <code>EMAIL_HOST</code>, <code>EMAIL_PORT</code>, <code>EMAIL_USER</code> and <code>EMAIL_PASS</code>) to backend/.env and restart the server.</p>
      <div class="dlg-foot"><button type="button" class="btn" data-close>Close</button></div>`, '[data-close]');
    return;
  }
  if (sec.pinSet) askPin(); else createPin();
}

/** Setup steps and details for one service, in the shared dialog. */
function integrationGuide(x, st, facility) {
  const facts = [];
  if (x.key === 'hitpay' && st.configured) {
    facts.push(st.sandbox ? 'Sandbox keys: payments are tests, no real money moves.' : 'Live keys: real payments.');
    facts.push(st.webhook ? 'Webhook salt set: payments are recorded automatically.' : 'No webhook salt: a payment is recorded when the customer comes back to their booking, or when staff press "Check payment".');
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
    ${approx && can('settings') ? '<div class="msg note" style="margin:0 16px 4px;">Showing Metro Manila. <a href="#/settings">Pin your facility</a> for an exact forecast and to show customers the map.</div>' : ''}
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
const people = { customers: { q: '', active: '' }, staff: { q: '', active: '' } };

function renderCustomers() { return renderPeople('customers'); }
function renderStaff() { return renderPeople('staff'); }

async function renderPeople(kind) {
  const isStaff = kind === 'staff';
  const f = people[kind];
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

  const search = debounce(() => { f.q = $('#uQ').value.trim(); refreshView(); });
  view.oninput = (e) => { if (e.target.id === 'uQ') search(); };
  view.onchange = (e) => { if (e.target.id === 'uActive') { f.active = e.target.value; refreshView(); } };
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
      ${isNew && isStaff ? field('Role', `<select name="role">${optionList([['staff', 'Staff - bookings, payments, schedule'], ['admin', 'Admin - everything']], 'staff')}</select>`, 'You can change this later under Roles & access.') : ''}
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
    await api(`/users/${u.id}/active`, { method: 'PATCH', body: { isActive: !off } });
    toast(off ? 'Account deactivated' : 'Account reactivated');
    closeModal();
    refreshView();
  });
}

/* =====================================================================
   AF-107  Roles & access
   ===================================================================== */
const rolesUi = { q: '' };

async function renderRoles() {
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

  const search = debounce(() => { rolesUi.q = $('#rQ').value.trim(); refreshView(); });
  view.oninput = (e) => { if (e.target.id === 'rQ') search(); };
  view.onchange = async (e) => {
    const sel = e.target.closest('select[data-id]');
    if (!sel) return;
    const u = users.find((x) => x.id === sel.dataset.id);
    try {
      await api(`/users/${u.id}/role`, { method: 'PATCH', body: { role: sel.value } });
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
          Asked for, together with a one-time code sent to your email, before any integration is turned on or off.
          ${me.pinSet ? 'Forgot it? Set a new one here with your password.' : ''}</p>
        <form id="pinForm">
          ${field('Account password', '<input name="password" type="password" required autocomplete="current-password" />')}
          <div class="row2">${pinField('pin', me.pinSet ? 'New PIN' : 'PIN', '4 to 6 digits. Not 1234 or 0000.', 'new-password')}${pinField('confirm', 'Type it again', '', 'new-password')}</div>
          <div class="dlg-foot" style="justify-content:flex-start;"><button class="btn primary" type="submit">${me.pinSet ? 'Change PIN' : 'Create PIN'}</button></div>
          <div class="msg error hidden" role="alert"></div>
        </form>
      </div></div>` : ''}
    </div>`;

  onSubmit($('#profForm'), async (d) => {
    const r = await userApi('/profile', { method: 'PUT', body: { firstName: d.firstName, lastName: d.lastName, phone: d.phone } });
    state.me.firstName = r.user.firstName; state.me.lastName = r.user.lastName;
    paintMe();
    toast('Profile saved');
  });
  onSubmit($('#pwForm'), async (d) => {
    if (d.newPassword !== d.confirm) throw new Error('The new passwords do not match.');
    await userApi('/change-password', { method: 'PUT', body: { currentPassword: d.currentPassword, newPassword: d.newPassword } });
    toast('Password changed. Please sign in again.');
    setTimeout(signOut, 1500); // changing the password ends every session, including this one
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
}

// press "/" to jump to the search box on any list screen
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  const q = view.querySelector('input[type=search]');
  if (q) { e.preventDefault(); q.focus(); q.select(); }
});

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
  if (!location.hash) location.hash = '#/dashboard';
  route();
})();
