<<<<<<< HEAD:frontend/js/nav.js
// The site's top navigation bar, shared by every customer page.
// Edit the links here and every page updates.
//
// A page shows it with:  <div class="navbar" data-nav="app"></div>   (signed-in pages)
//                    or:  <div class="navbar" data-nav="guest"></div> (login / register pages)
(function () {
  const NAV = {
    app: {
      home: 'dashboard.html',
      links: [
        { href: 'dashboard.html', label: 'Dashboard' },
        { href: 'courts.html', label: 'Courts' },
        { href: 'my-bookings.html', label: 'My Bookings' },
        { href: 'booking-status.html', label: 'Booking Status' },
        { href: 'announcements.html', label: 'Announcements' },
        { href: 'support.html', label: 'Support' },
        { href: 'profile.html', label: 'Profile' },
        { href: '#', label: 'Log out', id: 'logoutBtn' },
      ],
    },
    guest: {
      home: 'index.html',
      links: [{ href: 'index.html', label: 'Log in' }],
    },
  };

  const here = location.pathname.split('/').pop() || 'index.html';

  document.querySelectorAll('.navbar[data-nav]').forEach((bar) => {
    const cfg = NAV[bar.dataset.nav] || NAV.app;
    bar.innerHTML = `
      <a class="brand" href="${cfg.home}" aria-label="MAKI's Pickleball Court home">
        <img src="img/logo-mark.png" alt="" />
        <span class="wm"><b>MAKI'S</b><span>PICKLEBALL COURT</span></span>
      </a>
      <div class="links">
        ${cfg.links.map((l) => `<a href="${l.href}"${l.id ? ` id="${l.id}"` : ''}${l.href === here ? ' aria-current="page"' : ''}>${l.label}</a>`).join('')}
      </div>`;
  });

  const out = document.getElementById('logoutBtn');
  if (out) out.addEventListener('click', (e) => { e.preventDefault(); logout(); });
=======
/* One shared navbar for every logged-in page.
   Add or rename a link here and it changes everywhere. */
(function () {
    var links = [
    ['dashboard.html', 'Dashboard'],
    ['courts.html', 'Courts'],
    ['profile.html', 'Profile']
  ];

  var here = location.pathname.split('/').pop() || 'dashboard.html';
  // court-details and booking-confirmation belong to these sections
  var section = { 'court-details.html': 'courts.html', 'booking-confirmation.html': 'my-bookings.html' };
  var current = section[here] || here;

  var items = links.map(function (l) {
    return '<a href="' + l[0] + '"' + (l[0] === current ? ' aria-current="page"' : '') + '>' + l[1] + '</a>';
  }).join('');

  var html =
    '<div class="navbar no-print">' +
      '<a class="brand" href="dashboard.html" aria-label="MAKI\'s Pickleball Court home">' +
        '<img src="img/logo-mark.png" alt="" />' +
        '<span class="wm"><b>MAKI\'S</b><span>PICKLEBALL COURT</span></span>' +
      '</a>' +
      '<div class="links">' + items + '<a href="#" id="logoutBtn">Log out</a></div>' +
    '</div>';

  // Written right where the script tag sits, so the navbar is there on first paint (no flicker).
  document.write(html);
>>>>>>> a7268bdf5982b171a935f488c3beb16a426aba2c:public/js/nav.js
})();
