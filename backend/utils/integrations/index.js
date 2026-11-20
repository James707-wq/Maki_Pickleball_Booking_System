/**
 * Third-party services and whether each one is running.
 *   configured = its keys are in backend/.env (maps and weather need none; the custom API's address and
 *                secret are saved from the admin console instead)
 *   switchedOn = an admin hasn't turned it off (admin -> Integrations)
 *   active     = configured AND switchedOn - the only thing the rest of the code should check
 * Never expose secrets from here.
 */
const { open } = require('../secretBox');

const env = (k) => String(process.env[k] || '').trim();

/**
 * Google Sign-In client IDs, one per sign-in page:
 *   staff    = GOOGLE_CLIENT_ID, on the admin sign-in page
 *   customer = CUSTOM_GOOGLE_CLIENT_ID on the customer login and sign-up pages, or GOOGLE_CLIENT_ID when it isn't set
 */
const googleClientIds = () => ({
  staff: env('GOOGLE_CLIENT_ID'),
  customer: env('CUSTOM_GOOGLE_CLIENT_ID') || env('GOOGLE_CLIENT_ID'),
});

const NAMES = ['googleSignIn', 'googleCalendar', 'turnstile', 'maps', 'weather', 'email', 'qrCheckin', 'webhook'];
/** Names people see (security codes, alert emails). Keep in step with INTEGRATIONS in frontend/js/admin.js. */
const LABELS = {
  googleSignIn: 'Google Sign-In', googleCalendar: 'Google Calendar', turnstile: 'Cloudflare Turnstile',
  maps: 'Map', weather: 'Weather', email: 'Email', qrCheckin: 'QR check-in',
  webhook: 'Custom API (webhook)',
};

/* On/off switches (and the custom API's saved settings) live in the Settings document; cached briefly so checks stay cheap. */
const CACHE_MS = 15 * 1000;
let cache = { at: 0, switches: null, webhook: null };

const configured = {
  googleSignIn: () => Boolean(env('GOOGLE_CLIENT_ID') || env('CUSTOM_GOOGLE_CLIENT_ID')),
  googleCalendar: () => Boolean(env('GOOGLE_CALENDAR_ID') && env('GOOGLE_SERVICE_ACCOUNT_EMAIL') && env('GOOGLE_PRIVATE_KEY')),
  turnstile: () => Boolean(env('TURNSTILE_SITE_KEY') && env('TURNSTILE_SECRET_KEY')),
  maps: () => true,    // Leaflet + OpenStreetMap: no key needed
  weather: () => true, // Open-Meteo: no key needed
  email: () => Boolean(env('RESEND_API_KEY') || (env('EMAIL_HOST') && env('EMAIL_USER') && env('EMAIL_PASS'))),
  qrCheckin: () => true, // built in: no key needed
  // an address and a readable signing secret saved under admin -> Integrations (filled in by switches())
  webhook: () => Boolean(cache.webhook && cache.webhook.url && cache.webhook.secretOk),
};

async function switches() {
  if (cache.switches && Date.now() - cache.at < CACHE_MS) return cache.switches;
  try {
    const Settings = require('../../models/Settings');
    const s = await Settings.get();
    const saved = (s.integrationSwitches && s.integrationSwitches.toObject ? s.integrationSwitches.toObject() : s.integrationSwitches) || {};
    const w = s.webhook || {};
    cache = {
      at: Date.now(),
      switches: Object.fromEntries(NAMES.map((n) => [n, saved[n] !== false])),
      // never the secret itself: only whether it can be used
      webhook: { url: w.url || '', secretOk: Boolean(open(w.secret)), events: [...(w.events || [])], includeContact: Boolean(w.includeContact) },
    };
  } catch (err) {
    console.error('Could not read integration switches:', err.message);
    if (!cache.switches) return Object.fromEntries(NAMES.map((n) => [n, true])); // keys decide until the DB answers
  }
  return cache.switches;
}

/** Call after saving the switches (or the custom API's settings) so the change applies at once. */
const forgetSwitches = () => { cache = { at: 0, switches: null, webhook: null }; };

/** Each switch's default position, as declared in models/Settings.js (on, for every service today). */
function defaultSwitches() {
  const Settings = require('../../models/Settings');
  return Object.fromEntries(NAMES.map((n) => {
    const path = Settings.schema.path(`integrationSwitches.${n}`);
    return [n, path ? path.defaultValue !== false : true];
  }));
}

/**
 * What "reset to defaults" would change, from status(): { switches: { name: defaultPosition }, removeWebhook }.
 * Only switches that differ from their default are listed. The custom API's settings are only removed when asked.
 */
function planReset(now, { webhookSet = false, alsoWebhook = false } = {}) {
  const defaults = defaultSwitches();
  const switches = Object.fromEntries(NAMES.filter((n) => now[n] && now[n].switchedOn !== defaults[n]).map((n) => [n, defaults[n]]));
  return { switches, removeWebhook: Boolean(alsoWebhook && webhookSet) };
}

/** The custom API's saved settings: { url, secretOk, events, includeContact } (never the secret). */
async function webhookSettings() {
  await switches();
  return cache.webhook || { url: '', secretOk: false, events: [], includeContact: false };
}

/** Is this service configured and switched on? */
async function isActive(name) {
  if (name === 'webhook') await switches(); // its "configured" comes from the database, loaded with the switches
  if (!configured[name] || !configured[name]()) return false;
  return (await switches())[name] !== false;
}

async function status() {
  const sw = await switches();
  const out = {};
  for (const n of NAMES) {
    const c = configured[n]();
    out[n] = { configured: c, switchedOn: sw[n] !== false, active: c && sw[n] !== false };
  }
  // which Google client each sign-in page uses (the admin Integrations page explains it)
  out.googleSignIn.staffClient = Boolean(env('GOOGLE_CLIENT_ID'));
  out.googleSignIn.customerClient = env('CUSTOM_GOOGLE_CLIENT_ID') ? 'own' : env('GOOGLE_CLIENT_ID') ? 'shared' : 'none';
  return out;
}

/** Safe, public values the admin login page needs. */
async function publicConfig() {
  const google = (await isActive('googleSignIn')) ? googleClientIds() : { staff: '', customer: '' };
  return {
    googleClientId: google.staff,             // admin sign-in page
    customerGoogleClientId: google.customer,  // customer login and sign-up pages
    turnstileSiteKey: (await isActive('turnstile')) ? env('TURNSTILE_SITE_KEY') : '',
    // read-only flags so customer pages know what to show; changing them is admin-only
    features: {
      map: await isActive('maps'),
      weather: await isActive('weather'),
      addToCalendar: await isActive('googleCalendar'),
      email: await isActive('email'),
      qrCheckin: await isActive('qrCheckin'),
    },
  };
}

module.exports = {
  env, NAMES, LABELS, configured, isActive, status, publicConfig, forgetSwitches, webhookSettings, googleClientIds,
  defaultSwitches, planReset,
};
