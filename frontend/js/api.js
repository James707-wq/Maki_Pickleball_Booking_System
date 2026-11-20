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

// ---- court photos: a court's own photo if the admin set one, otherwise a mockup picked from its id ----
const COURT_PHOTOS = ['img/courts/court-1.jpg', 'img/courts/court-2.jpg', 'img/courts/court-3.jpg', 'img/courts/court-4.jpg', 'img/courts/court-5.jpg', 'img/courts/court-6.jpg'];
function courtImage(court) {
  const url = court && court.imageUrl ? String(court.imageUrl).trim() : '';
  if (url && /^(https?:\/\/|img\/|\/img\/)/i.test(url)) return url;
  const key = String((court && (court._id || court.name)) || '');
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return COURT_PHOTOS[h % COURT_PHOTOS.length];
}

// ---- toast: toast('Saved') / toast('Something failed', true) ----
function toast(text, isError = false) {
  let el = document.getElementById('makiToast');
  if (!el) { el = document.createElement('div'); el.id = 'makiToast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.textContent = text;
  el.classList.toggle('err', !!isError);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---- animated number: countUp(el, 12) ----
function countUp(el, target) {
  const end = Number(target) || 0;
  if (!el) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || end === 0) { el.textContent = end; return; }
  const start = performance.now(), dur = 700;
  const step = (t) => {
    const p = Math.min((t - start) / dur, 1);
    el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- micro-interactions shared by every customer page ----
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // scroll reveal for anything marked data-reveal
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.08 }) : null;
  function watch(root) {
    (root || document).querySelectorAll('[data-reveal]:not(.in)').forEach((el, i) => {
      if (!io || reduce) { el.classList.add('in'); return; }
      el.style.transitionDelay = `${Math.min(i, 6) * 60}ms`;
      io.observe(el);
    });
  }
  window.revealIn = watch;
  document.addEventListener('DOMContentLoaded', () => watch());

  // cursor spotlight on .spot / cards
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('.spot, .court-card, .quick a, .stat');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });

  // ripple on button press
  document.addEventListener('pointerdown', (e) => {
    if (reduce) return;
    const b = e.target.closest && e.target.closest('button:not(:disabled), .btn');
    if (!b || b.classList.contains('pw-toggle')) return;
    const r = b.getBoundingClientRect();
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.left = `${e.clientX - r.left}px`;
    s.style.top = `${e.clientY - r.top}px`;
    b.appendChild(s);
    setTimeout(() => s.remove(), 650);
  });
})();

// ---- confetti burst in brand colours (used after a booking is made) ----
function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f9e20b', '#33d9ff', '#0a325e', '#0b4fa8', '#ffffff'];
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:70;overflow:hidden';
  for (let i = 0; i < 80; i += 1) {
    const p = document.createElement('i');
    const size = 6 + Math.random() * 7;
    p.style.cssText = `position:absolute;left:${Math.random() * 100}%;top:-20px;width:${size}px;height:${size * (Math.random() < .5 ? 1 : .45)}px;` +
      `background:${colors[i % colors.length]};border-radius:${Math.random() < .3 ? '50%' : '2px'};box-shadow:0 0 0 1px rgba(10,50,94,.08);`;
    box.appendChild(p);
    p.animate([
      { transform: 'translate3d(0,0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate3d(${(Math.random() - .5) * 240}px, ${window.innerHeight + 60}px, 0) rotate(${Math.random() * 720}deg)`, opacity: .9 },
    ], { duration: 1800 + Math.random() * 1400, delay: Math.random() * 300, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3600);
}
