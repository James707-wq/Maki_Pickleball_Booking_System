// Optional third-party services on the customer pages (Google Sign-In, Turnstile, map, weather...).
// The admin switches them on/off under Integrations; this file only reads what is on.
(function () {
  const API = window.API_ROOT || '/api';
  let configPromise = null;

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.onload = resolve; s.onerror = () => reject(new Error('load failed'));
    document.head.appendChild(s);
  });

  /** { googleClientId (staff), customerGoogleClientId, turnstileSiteKey, features: { payOnline, map, weather, addToCalendar } } */
  function config() {
    if (!configPromise) {
      configPromise = fetch(API + '/integrations/config')
        .then((r) => r.json())
        .catch(() => ({}))
        .then((c) => ({ googleClientId: '', customerGoogleClientId: '', turnstileSiteKey: '', features: {}, ...c }));
    }
    return configPromise;
  }

  /**
   * Renders the customers' "Continue with Google" button into `box` (which also holds the "or" divider).
   * It uses the customers' Google client: CUSTOM_GOOGLE_CLIENT_ID on the server, or GOOGLE_CLIENT_ID when that isn't set.
   * onCredential(credential) is called after the person picks their Google account.
   */
  async function mountGoogle(box, slot, { text = 'continue_with', onCredential }) {
    const cfg = await config();
    const clientId = cfg.customerGoogleClientId || cfg.googleClientId; // an older server only sends googleClientId
    if (!clientId) return false;
    try { await loadScript('https://accounts.google.com/gsi/client'); } catch (e) { return false; }
    google.accounts.id.initialize({ client_id: clientId, ux_mode: 'popup', itp_support: true, callback: ({ credential }) => onCredential(credential) });
    box.hidden = false;
    const width = Math.max(200, Math.min(400, Math.floor(slot.getBoundingClientRect().width) || 320));
    google.accounts.id.renderButton(slot, { type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular', text, logo_alignment: 'center', width });
    requestAnimationFrame(() => box.classList.add('is-ready'));
    return true;
  }

  /**
   * Cloudflare Turnstile, invisible unless Cloudflare needs a click.
   * Returns { getToken(): Promise<string>, reset() }. When Turnstile is off, getToken() gives ''.
   */
  function mountTurnstile(slot, onError) {
    const state = { enabled: false, id: null, token: '', waiters: [] };
    const ready = (t) => { state.token = t; state.waiters.splice(0).forEach((fn) => fn(t)); };
    const started = config().then(async (cfg) => {
      if (!cfg.turnstileSiteKey) return;
      try { await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'); } catch (e) {
        if (onError) onError('Could not load the security check. Check your connection and reload the page.');
        return;
      }
      state.enabled = true;
      state.id = turnstile.render(slot, {
        sitekey: cfg.turnstileSiteKey, appearance: 'interaction-only', theme: 'light',
        callback: ready,
        'expired-callback': () => { state.token = ''; },
        'error-callback': () => { state.token = ''; if (onError) onError('The security check failed. Reload the page and try again.'); },
      });
    });
    return {
      async getToken() {
        await started;
        if (!state.enabled) return '';
        if (state.token) return state.token;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('The security check is taking too long. Reload the page and try again.')), 15000);
          state.waiters.push((t) => { clearTimeout(timer); resolve(t); });
        });
      },
      needsWait() { return state.enabled && !state.token; },
      reset() {
        state.token = '';
        if (state.enabled && window.turnstile && state.id !== null) turnstile.reset(state.id); // a token works only once
      },
    };
  }

  let leaflet = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (!leaflet) {
      leaflet = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
        loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js').then(resolve, (e) => { leaflet = null; reject(e); });
      });
    }
    return leaflet;
  }

  /* ---------- Map: the facility on OpenStreetMap ---------- */
  let facilityPromise = null;
  const facility = () => {
    if (!facilityPromise) facilityPromise = fetch(API + '/facility').then((r) => r.json()).catch(() => ({ map: false }));
    return facilityPromise;
  };
  const directionsUrl = (loc) => `https://www.openstreetmap.org/directions?to=${loc.lat}%2C${loc.lng}`;
  /** Directions to the pin in the apps people use (plain links, no keys). */
  const directionLinks = (loc) => ({
    google: `https://www.google.com/maps/dir/?api=1&destination=${loc.lat}%2C${loc.lng}`,
    waze: `https://waze.com/ul?ll=${loc.lat}%2C${loc.lng}&navigate=yes`,
    osm: directionsUrl(loc),
  });

  /** A Leaflet map with OpenStreetMap tiles inside `el` (loads Leaflet first). */
  async function osmMap(el, center, zoom, options = {}) {
    await loadLeaflet();
    const map = L.map(el, { scrollWheelZoom: false, ...options }).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 60);
    return map;
  }

  /**
   * Fills `card` (hidden until ready) with a map of the facility, its address and a directions link.
   * Does nothing when the map is switched off or the facility isn't pinned yet. Returns true if shown.
   */
  async function mountFacilityMap(card, { height = 220, zoom = 16 } = {}) {
    const f = await facility();
    if (!card || !f.map || !f.location) return false;
    const { lat, lng, address } = f.location;
    card.innerHTML = `
      <div class="find-us-head">
        <div><b>Find us</b><span>${String(address || "MAKI's PickleBall Court").replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</span></div>
        <a class="btn secondary small" href="${directionsUrl(f.location)}" target="_blank" rel="noopener">Get directions</a>
      </div>
      <div class="facility-map" style="height:${height}px" role="img" aria-label="Map showing where the facility is"></div>`;
    card.hidden = false;
    try {
      const map = await osmMap(card.querySelector('.facility-map'), [lat, lng], zoom);
      L.marker([lat, lng]).addTo(map);
    } catch (e) {
      card.querySelector('.facility-map').outerHTML = '<p class="subtitle" style="margin:8px 0 0;">The map could not load. Use "Get directions" instead.</p>';
    }
    return true;
  }

  /* ---------- Calendar: add a booking to Google, Apple or Outlook calendars ---------- */
  const minutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
  const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261112T020000Z
  const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  /** { google, ics, filename } for a booking ({ date, startTime, endTime, courtName, referenceNumber }). */
  function calendarLinks(b, location) {
    const start = new Date(new Date(b.date).getTime() + minutes(b.startTime) * 60000);
    const end = new Date(new Date(b.date).getTime() + minutes(b.endTime) * 60000);
    const court = (b.court && b.court.name) || b.courtName || 'Court';
    const title = `Pickleball · ${court}`;
    const details = `Booking ${b.referenceNumber} at MAKI's PickleBall Court. Show this reference at check-in.`;
    const where = location || (b.court && b.court.location) || "MAKI's PickleBall Court";
    const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
      action: 'TEMPLATE', text: title, dates: `${utcStamp(start)}/${utcStamp(end)}`, details, location: where,
    });
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MAKI PickleBall Court//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:${b.referenceNumber}@makis-pickleball`, `DTSTAMP:${utcStamp(new Date())}`,
      `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`, `SUMMARY:${icsText(title)}`,
      `DESCRIPTION:${icsText(details)}`, `LOCATION:${icsText(where)}`,
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    return { google, ics: 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics), filename: `pickleball-${b.referenceNumber}.ics` };
  }

  /** Small "Add to calendar" links (Google + .ics for Apple/Outlook), or '' when switched off / not confirmed. */
  async function calendarButtons(b, { compact = false } = {}) {
    const cfg = await config();
    if (!cfg.features.addToCalendar || b.status !== 'confirmed') return '';
    const f = await facility();
    const l = calendarLinks(b, f.location && f.location.address);
    return `<span class="cal-links${compact ? ' compact' : ''}">
      <a href="${l.google}" target="_blank" rel="noopener" title="Add to Google Calendar">${compact ? '+ Google Calendar' : 'Add to Google Calendar'}</a>
      <a href="${l.ics}" download="${l.filename}" title="For Apple Calendar or Outlook">${compact ? '+ Apple/Outlook' : 'Apple / Outlook (.ics)'}</a>
    </span>`;
  }

  /* ---------- the facility's rules (booking rules, cancellation policy, payment) ---------- */
  const escText = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const POLICY_TITLES = { booking: 'Booking rules', cancellation: 'Cancellation and refunds', payment: 'Payment' };
  /**
   * Fills `el` with the rules the admin set (admin -> Hours & rules) as lists, and shows it.
   * parts: any of 'booking', 'cancellation', 'payment'. Returns the rules, or null when they could not load.
   */
  async function mountPolicy(el, parts = ['cancellation'], { headings = false } = {}) {
    if (!el) return null;
    const f = await facility();
    const lines = f && f.rules && f.rules.lines;
    if (!lines) return null;
    el.innerHTML = parts.filter((p) => lines[p] && lines[p].length)
      .map((p) => `${headings ? `<h2>${POLICY_TITLES[p]}</h2>` : ''}<ul class="policy-list">${lines[p].map((l) => `<li>${escText(l)}</li>`).join('')}</ul>`).join('');
    el.hidden = false;
    return f.rules;
  }

  window.Integrations = {
    config, mountGoogle, mountTurnstile, loadLeaflet, osmMap, facility, mountFacilityMap, directionsUrl, directionLinks, calendarLinks, calendarButtons,
    mountPolicy,
  };
})();
