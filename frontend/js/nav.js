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
})();
