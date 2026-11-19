// Shared fetch helper for the whole frontend
const API_BASE = window.API_ROOT || '/api';

// version: the record's writeTS as it was shown on screen. The server refuses the change (409
// WRITE_CONFLICT) if someone else changed the record since, instead of silently overwriting it.
async function apiRequest(path, { method = 'GET', body, auth = false, version } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (version) headers['If-Match'] = `"${new Date(version).toISOString()}"`;
  if (auth) {
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.status === 401 && auth) {
    // the sign-in has ended (signed out on another device, expired, or ended by the facility): sign in again
    try { sessionStorage.setItem('signedOutReason', data.message || 'Please sign in again.'); } catch (e) { /* storage off */ }
    localStorage.removeItem('token');
    window.location.href = 'index.html';
  }
  if (!res.ok || data.success === false) {
    const err = new Error(data.message || 'Something went wrong');
    err.status = res.status;
    err.code = data.code; // 'WRITE_CONFLICT' when the record changed under us
    throw err;
  }
  return data;
}

function showMsg(el, text, type = 'error') {
  el.textContent = text;
  el.className = `msg ${type}`;
}

function requireAuth() {
  if (!localStorage.getItem('token')) {
    window.location.href = 'index.html';
  }
}

// remote: also end the session on the server (AF-144), so the token stops working everywhere, not just here
function logout({ remote = false } = {}) {
  const token = localStorage.getItem('token');
  if (remote && token) {
    try {
      fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
    } catch (e) { /* signed out here anyway */ }
  }
  localStorage.removeItem('token');
  window.location.href = 'index.html';
}

// The page's filters live in its address (e.g. my-bookings.html?status=cancelled&view=calendar), so a reload,
// the Back button or a shared link opens the same view.
function pageParams() {
  return new URLSearchParams(window.location.search);
}
function setPageParams(values) {
  const qs = new URLSearchParams(window.location.search);
  Object.entries(values).forEach(([k, v]) => { if (v === '' || v == null) qs.delete(k); else qs.set(k, String(v)); });
  const next = `${window.location.pathname}${qs.toString() ? `?${qs}` : ''}${window.location.hash}`;
  if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, '', next);
}

// Escape text before putting it into innerHTML (prevents XSS)
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Dates are stored as Philippine midnight, so always display them in Manila time
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric' });
}

// ---- small UI helpers shared by every page ----
document.addEventListener('DOMContentLoaded', () => {
  // highlight the current page in the navbar
  // works for clean addresses ("/courts") and file names ("/courts.html") alike
  const nameOf = (p) => String(p || '').split(/[?#]/)[0].split('/').pop().replace(/\.html$/, '') || 'index';
  const here = nameOf(location.pathname);
  document.querySelectorAll('.navbar .links a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href !== '#' && nameOf(href) === here) a.setAttribute('aria-current', 'page');
  });

  // show / hide password
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.textContent = 'Show';
    btn.setAttribute('aria-label', 'Show password');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    wrap.appendChild(btn);
  });
});
