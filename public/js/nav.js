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
})();
