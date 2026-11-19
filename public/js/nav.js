/* One shared navbar for every logged-in page.
   Add or rename a link here and it changes everywhere.
   On phones the main links turn into a bottom tab bar (see style.css). */
(function () {
  var I = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    courts: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 12h18"/></svg>',
    bookings: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 15l2.5 2.5L16 13"/></svg>',
    profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    ann: '<svg viewBox="0 0 24 24"><path d="M4 14V9a2 2 0 0 1 2-2h3l9-4v17l-9-4H6a2 2 0 0 1-2-2ZM9 16l2 5h3l-2-5"/></svg>',
    status: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    help: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5Z"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg>',
    pal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M12 21a2.5 2.5 0 0 1 0-5h2a3 3 0 0 0 3-3"/></svg>',
  };
  var links = [
    ['dashboard.html', 'Home', I.home],
    ['courts.html', 'Courts', I.courts],
    ['my-bookings.html', 'Bookings', I.bookings],
    ['profile.html', 'Profile', I.profile],
  ];
  var more = [
    ['profile.html#avatar', 'Customize avatar', I.pal],
    ['announcements.html', 'Announcements', I.ann],
    ['booking-status.html', 'Check booking status', I.status],
    ['feedback.html', 'Feedback & ratings', I.star],
    ['support.html', 'Contact support', I.help],
    ['terms.html', 'Terms & policies', I.doc],
  ];

  var here = location.pathname.split('/').pop() || 'dashboard.html';
  var section = { 'court-details.html': 'courts.html', 'booking-confirmation.html': 'my-bookings.html', 'booking-status.html': 'my-bookings.html' };
  var current = section[here] || here;

  var items = links.map(function (l) {
    return '<a href="' + l[0] + '"' + (l[0] === current ? ' aria-current="page"' : '') + '>' + l[2] + '<span>' + l[1] + '</span></a>';
  }).join('');
  var menu = more.map(function (l) { return '<a href="' + l[0] + '">' + l[2] + l[1] + '</a>'; }).join('');

  var html =
    '<header class="navbar no-print">' +
      '<a class="brand" href="dashboard.html" aria-label="MAKI\'s Pickleball Court home">' +
        '<span class="mark"><img src="img/logo-mark.png" alt="" /></span>' +
        '<span class="wm"><b>MAKI\'S</b><span>PICKLEBALL COURT</span></span>' +
      '</a>' +
      '<nav class="links" aria-label="Main">' + items + '</nav>' +
      '<div class="nav-right">' +
        '<button type="button" class="me-chip" id="meChip" aria-haspopup="true" aria-expanded="false" aria-controls="meMenu">' +
          '<span class="me-av" data-avatar></span><span class="me-name" data-first-name>Player</span>' +
          '<svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="me-menu" id="meMenu" hidden>' +
          '<div class="me-head"><span class="me-av" data-avatar></span><div><b data-full-name>Player</b><small data-email></small></div></div>' +
          menu + '<hr /><a href="#" id="logoutBtn" class="danger-link">' + I.out + 'Log out</a>' +
        '</div>' +
      '</div>' +
    '</header>';

  // Written right where the script tag sits, so the navbar is there on first paint (no flicker).
  document.write('<script src="js/avatar.js"><\/script>');
  document.write(html);

  function paint(cfg, user) {
    if (!window.MakiAvatar) return;
    var s = MakiAvatar.svg(cfg || MakiAvatar.cached() || MakiAvatar.DEFAULT, { title: user ? user.firstName : 'Your avatar' });
    document.querySelectorAll('[data-avatar]').forEach(function (el) { el.innerHTML = s; });
    if (user) {
      document.querySelectorAll('[data-first-name]').forEach(function (el) { el.textContent = user.firstName; });
      document.querySelectorAll('[data-full-name]').forEach(function (el) { el.textContent = user.firstName + ' ' + user.lastName; });
      document.querySelectorAll('[data-email]').forEach(function (el) { el.textContent = user.email; });
    }
  }
  window.MakiNav = {
    setUser: function (user) {
      if (!user) return;
      if (window.MakiAvatar) MakiAvatar.remember(user.avatar || MakiAvatar.DEFAULT);
      paint(user.avatar || MakiAvatar.DEFAULT, user);
    },
    paint: paint,
  };

  document.addEventListener('DOMContentLoaded', function () {
    paint(null, null);
    var chip = document.getElementById('meChip'), box = document.getElementById('meMenu');
    function close() { box.hidden = true; chip.setAttribute('aria-expanded', 'false'); }
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = box.hidden;
      box.hidden = !open; chip.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) { if (!box.hidden && !box.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    var bar = document.querySelector('.navbar');
    var onScroll = function () { bar.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

    // fill the avatar + name from the profile (each page may also call MakiNav.setUser)
    var token = localStorage.getItem('token');
    if (!token) return;
    fetch('/api/users/profile', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.user) window.MakiNav.setUser(d.user); })
      .catch(function () { /* offline: keep the cached avatar */ });
  });
})();
