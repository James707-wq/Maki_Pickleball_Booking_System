// The site's top navigation bar, shared by every customer page. Edit the links here and every page updates.
//
// A page shows it with:  <div class="navbar" data-nav="app"></div>   (signed-in pages)
//                    or:  <div class="navbar" data-nav="guest"></div> (pages for visitors who are not signed in)
// and loads js/avatar.js before this file (it is loaded here too if a page forgets).
//
// Signed in, wide screens: Home · Book a court · My bookings · More, then the notifications bell and the account menu
// (the player's avatar and first name). Phones: the logo, the bell and one Menu button that lists everything.
(function () {
  // clean addresses (/my-bookings) when the backend serves the pages; file names on another static host
  const to = (name) => (window.PAGE ? window.PAGE(name) : `${name}.html`);
  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    court: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16M3 12h18"/>',
    bookings: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 15l2 2 4-4"/>',
    news: '<path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>',
    map: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 015 .6c0 1.8-2.5 2.1-2.5 3.7M12 17h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M12 21a2.5 2.5 0 010-5h2a3 3 0 003-3"/>',
    out: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    bell: '<path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
  };
  const svg = (name, cls = '') => `<svg class="ico${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

  const MAIN = [
    { page: 'dashboard', label: 'Home', icon: 'home' },
    { page: 'courts', label: 'Book a court', icon: 'court' },
    { page: 'my-bookings', label: 'My bookings', icon: 'bookings' },
  ];
  const MORE = [
    { page: 'announcements', label: 'Announcements', icon: 'news', hint: 'News from the facility' },
    { page: 'location', label: 'Find us', icon: 'map', hint: 'Map, directions and opening hours' },
    { page: 'booking-status', label: 'Check a booking', icon: 'search', hint: 'Look one up by its reference' },
    { page: 'support', label: 'Help & support', icon: 'help', hint: 'Ask a question or report a problem' },
  ];
  // the account menu (and the end of the phone menu)
  const ACCOUNT = [
    { page: 'profile', label: 'My profile', icon: 'user', hint: 'Name, password, devices' },
    { page: 'profile', hash: 'avatar', label: 'Customize avatar', icon: 'palette', hint: 'Design your player look' },
  ];

  // the page's name without .html, whichever address opened it ("/courts" or "/courts.html")
  const nameOf = (p) => String(p || '').split(/[?#]/)[0].split('/').pop().replace(/\.html$/, '') || 'index';
  // pages without their own link light up the section they belong to
  const SECTION = { 'court-details': 'courts', 'booking-confirmation': 'my-bookings', feedback: 'my-bookings' };
  const here = SECTION[nameOf(location.pathname)] || nameOf(location.pathname);
  const current = (l) => (l.page === here && !l.hash ? ' aria-current="page"' : '');
  const href = (l) => `${to(l.page)}${l.hash ? `#${l.hash}` : ''}`;

  const brand = (home) => `<a class="brand" href="${home}" aria-label="MAKI's Pickleball Court home">
      <span class="mark"><img src="img/logo-mark.png" alt="" /></span>
      <span class="wm"><b>MAKI'S</b><span>PICKLEBALL COURT</span></span>
    </a>`;
  const item = (l) => `<a class="nav-item" href="${href(l)}"${current(l)}>${svg(l.icon)}<span><b>${l.label}</b>${l.hint ? `<small>${l.hint}</small>` : ''}</span></a>`;
  const logoutItem = `<a class="nav-item" href="#" data-logout>${svg('out')}<span><b>Log out</b></span></a>`;
  // the avatar shows initials (or a person icon) until js/avatar.js and the profile are there
  const avatarSlot = `<span class="nav-avatar" data-me-avatar aria-hidden="true">${svg('user')}</span>`;
  const who = `<div class="nav-who">${avatarSlot}<div><b data-me-name>Your account</b><small data-me-email></small></div></div>`;

  function appBar() {
    const inMore = MORE.some((l) => l.page === here);
    return `${brand(to('dashboard'))}
      <nav class="nav-main" aria-label="Main">
        ${MAIN.map((l) => `<a class="nav-link" href="${to(l.page)}"${current(l)}>${l.label}</a>`).join('')}
        <div class="nav-drop">
          <button type="button" class="nav-btn nav-link nav-toggle${inMore ? ' is-here' : ''}" aria-expanded="false" aria-controls="navMore">More ${svg('chev', 'chev')}</button>
          <div class="nav-menu" id="navMore" hidden>${MORE.map(item).join('')}</div>
        </div>
      </nav>
      <div class="nav-right">
        <a class="nav-bell" href="${to('notifications')}"${current({ page: 'notifications' })} title="Notifications" aria-label="Notifications">${svg('bell')}<span class="nav-count" hidden></span></a>
        <div class="nav-drop nav-account-drop">
          <button type="button" class="nav-btn nav-account${here === 'profile' ? ' is-here' : ''}" aria-expanded="false" aria-controls="navAccount" title="Your account">
            ${avatarSlot}<span class="nav-name">Account</span>${svg('chev', 'chev')}</button>
          <div class="nav-menu right" id="navAccount" hidden>
            ${who}
            ${ACCOUNT.map(item).join('')}
            ${logoutItem}
          </div>
        </div>
        <button type="button" class="nav-btn nav-burger" aria-expanded="false" aria-controls="navSheet">${svg('menu', 'when-closed')}${svg('close', 'when-open')}<span>Menu</span></button>
      </div>
      <div class="nav-sheet" id="navSheet" hidden>
        ${who}
        <div class="nav-group">${MAIN.map(item).join('')}
          <a class="nav-item" href="${to('notifications')}"${current({ page: 'notifications' })}>${svg('bell')}<span><b>Notifications <em class="nav-sheet-count" hidden></em></b></span></a></div>
        <div class="nav-group">${MORE.map(item).join('')}</div>
        <div class="nav-group">${ACCOUNT.map((l) => item({ ...l, hint: '' })).join('')}${logoutItem}</div>
      </div>`;
  }

  const bars = [...document.querySelectorAll('.navbar[data-nav]')];
  bars.forEach((bar) => {
    if (bar.dataset.nav === 'guest') {
      bar.innerHTML = `${brand('./')}<nav class="nav-main is-guest" aria-label="Main"><a class="nav-link" href="./">Log in</a></nav>`;
      return;
    }
    bar.innerHTML = appBar();
    wire(bar);
  });

  // the floating bar gets a firmer shadow once the page scrolls under it
  if (bars.length) {
    const onScroll = () => bars.forEach((bar) => bar.classList.toggle('scrolled', window.scrollY > 8));
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- menus: one open at a time; click outside or Escape closes ---------- */
  function wire(bar) {
    const toggles = [...bar.querySelectorAll('[aria-controls]')];
    const panelOf = (btn) => document.getElementById(btn.getAttribute('aria-controls'));
    const close = (except) => toggles.forEach((b) => {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false');
      panelOf(b).hidden = true;
    });
    toggles.forEach((btn) => btn.addEventListener('click', (e) => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      close(btn);
      btn.setAttribute('aria-expanded', String(open));
      panelOf(btn).hidden = !open;
      bar.classList.toggle('sheet-open', open && btn.classList.contains('nav-burger'));
      if (!open) bar.classList.remove('sheet-open');
      // opened from the keyboard: start on the first entry
      if (open && e.detail === 0) { const first = panelOf(btn).querySelector('a'); if (first) first.focus(); }
    }));
    document.addEventListener('click', (e) => { if (!bar.contains(e.target)) { close(); bar.classList.remove('sheet-open'); } });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const openBtn = toggles.find((b) => b.getAttribute('aria-expanded') === 'true');
      if (!openBtn) return;
      close(); bar.classList.remove('sheet-open');
      openBtn.focus();
    });
    // leaving a desktop menu with Tab closes it
    bar.querySelectorAll('.nav-drop').forEach((drop) => drop.addEventListener('focusout', (e) => {
      if (drop.contains(e.relatedTarget)) return;
      const btn = drop.querySelector('[aria-controls]'); // close this menu only (another may just have opened)
      if (btn.getAttribute('aria-expanded') === 'true') { btn.setAttribute('aria-expanded', 'false'); panelOf(btn).hidden = true; }
    }));
    // the same page's #avatar link: scroll to the avatar studio and close the menu
    bar.querySelectorAll('a[href$="#avatar"]').forEach((a) => a.addEventListener('click', () => { close(); bar.classList.remove('sheet-open'); }));
    bar.querySelectorAll('[data-logout]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof logout === 'function') logout({ remote: true });
    }));
    fillAccount(bar);
  }

  /* ---------- who is signed in (name, email, avatar), and how many notifications are unread ---------- */
  const CACHE = 'navMe';
  let lastMe = null;
  function showMe(bar, me) {
    if (!me || !me.firstName) return;
    lastMe = me;
    const full = `${me.firstName} ${me.lastName || ''}`.trim();
    const initials = `${me.firstName[0] || ''}${(me.lastName || '')[0] || ''}`.toUpperCase();
    // js/avatar.js draws only known option keys, so a stored avatar can't inject markup
    const face = window.MakiAvatar ? MakiAvatar.svg(me.avatar || MakiAvatar.DEFAULT) : null;
    bar.querySelectorAll('[data-me-avatar]').forEach((el) => { if (face) el.innerHTML = face; else el.textContent = initials || '?'; });
    bar.querySelector('.nav-name').textContent = me.firstName;
    bar.querySelectorAll('[data-me-name]').forEach((el) => { el.textContent = full; });
    bar.querySelectorAll('[data-me-email]').forEach((el) => { el.textContent = me.email || ''; });
  }
  const remember = (me) => {
    try { sessionStorage.setItem(CACHE, JSON.stringify(me)); } catch (e) { /* private mode */ }
    if (window.MakiAvatar && me.avatar) MakiAvatar.remember(me.avatar); // the login page greets a returning player with it
  };
  const meOf = (u) => ({ firstName: u.firstName, lastName: u.lastName, email: u.email, avatar: u.avatar || null });

  async function fillAccount(bar) {
    const token = localStorage.getItem('token');
    if (!token) return;
    try { showMe(bar, JSON.parse(sessionStorage.getItem(CACHE) || 'null')); } catch (e) { /* no cache yet */ }
    const get = (path) => fetch(`${window.API_ROOT || '/api'}${path}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [profile, notes] = await Promise.all([get('/users/profile'), get('/notifications?limit=1')]);
    if (profile && profile.user) {
      const me = meOf(profile.user);
      showMe(bar, me);
      remember(me);
    }
    const unread = notes && Number(notes.unread);
    const count = bar.querySelector('.nav-count');
    const bell = bar.querySelector('.nav-bell');
    const sheetCount = bar.querySelector('.nav-sheet-count');
    if (sheetCount) { sheetCount.textContent = unread > 0 ? `${unread} new` : ''; sheetCount.hidden = !(unread > 0); }
    if (count) count.hidden = !(unread > 0); // also hides it again once everything is read
    if (bell && !(unread > 0)) { bell.setAttribute('aria-label', 'Notifications'); bell.title = 'Notifications'; }
    if (count && unread > 0) {
      count.textContent = unread > 9 ? '9+' : String(unread);
      count.hidden = false;
      bell.setAttribute('aria-label', `Notifications: ${unread} unread`);
      bell.title = `${unread} unread notification${unread === 1 ? '' : 's'}`;
    }
  }
  const appBars = () => document.querySelectorAll('.navbar[data-nav="app"]');
  window.navRefreshAccount = () => appBars().forEach((bar) => fillAccount(bar));
  // a page that already has the user (profile saved, avatar saved) updates the bar right away
  window.MakiNav = {
    setUser(user) {
      if (!user || !user.firstName) return;
      const me = meOf(user);
      appBars().forEach((bar) => showMe(bar, me));
      remember(me);
    },
  };

  // a page that did not load js/avatar.js: load it now, then swap the initials for the avatar
  if (bars.length && !window.MakiAvatar) {
    const s = document.createElement('script');
    s.src = 'js/avatar.js';
    s.onload = () => { if (lastMe) appBars().forEach((bar) => showMe(bar, lastMe)); };
    document.head.appendChild(s);
  }
})();
