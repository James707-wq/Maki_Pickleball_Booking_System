// Shared fetch helper for the whole frontend
const API_BASE = '/api';

async function apiRequest(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.message || 'Something went wrong');
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

function logout() {
  localStorage.removeItem('token');
  window.location.href = 'index.html';
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
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.navbar .links a[href]').forEach((a) => {
    if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
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
