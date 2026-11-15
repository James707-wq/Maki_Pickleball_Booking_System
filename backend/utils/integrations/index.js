/**
 * Third-party services and whether each one is running.
 *   configured = its keys are in backend/.env (maps and weather need none)
 *   switchedOn = an admin hasn't turned it off (admin -> Opening hours -> Integrations)
 *   active     = configured AND switchedOn - the only thing the rest of the code should check
 * Never expose secrets from here.
 */
const env = (k) => String(process.env[k] || '').trim();

const NAMES = ['googleSignIn', 'googleCalendar', 'turnstile', 'hitpay', 'maps', 'weather', 'sms', 'email', 'qrCheckin'];
/** Names people see (security codes, alert emails). Keep in step with INTEGRATIONS in frontend/js/admin.js. */
const LABELS = {
  googleSignIn: 'Google Sign-In', googleCalendar: 'Google Calendar', turnstile: 'Cloudflare Turnstile',
  hitpay: 'HitPay', maps: 'Map', weather: 'Weather', sms: 'SMS (Semaphore)', email: 'Email', qrCheckin: 'QR check-in',
};

const configured = {
  googleSignIn: () => Boolean(env('GOOGLE_CLIENT_ID')),
  googleCalendar: () => Boolean(env('GOOGLE_CALENDAR_ID') && env('GOOGLE_SERVICE_ACCOUNT_EMAIL') && env('GOOGLE_PRIVATE_KEY')),
  turnstile: () => Boolean(env('TURNSTILE_SITE_KEY') && env('TURNSTILE_SECRET_KEY')),
  hitpay: () => Boolean(env('HITPAY_API_KEY')),
  maps: () => true,    // Leaflet + OpenStreetMap: no key needed
  weather: () => true, // Open-Meteo: no key needed
  sms: () => Boolean(env('SEMAPHORE_API_KEY')),
  email: () => Boolean(env('RESEND_API_KEY') || (env('EMAIL_HOST') && env('EMAIL_USER') && env('EMAIL_PASS'))),
  qrCheckin: () => true, // built in: no key needed
};
const hitpayWebhookConfigured = () => configured.hitpay() && Boolean(env('HITPAY_WEBHOOK_SALT'));
/** HitPay sandbox (test payments) unless HITPAY_SANDBOX=false, which needs live keys. */
const hitpaySandbox = () => env('HITPAY_SANDBOX').toLowerCase() !== 'false';

/* On/off switches live in the Settings document; cached briefly so checks stay cheap. */
const CACHE_MS = 15 * 1000;
let cache = { at: 0, switches: null };

async function switches() {
  if (cache.switches && Date.now() - cache.at < CACHE_MS) return cache.switches;
  try {
    const Settings = require('../../models/Settings');
    const s = await Settings.get();
    const saved = (s.integrationSwitches && s.integrationSwitches.toObject ? s.integrationSwitches.toObject() : s.integrationSwitches) || {};
    cache = { at: Date.now(), switches: Object.fromEntries(NAMES.map((n) => [n, saved[n] !== false])) };
  } catch (err) {
    console.error('Could not read integration switches:', err.message);
    if (!cache.switches) return Object.fromEntries(NAMES.map((n) => [n, true])); // keys decide until the DB answers
  }
  return cache.switches;
}

/** Call after saving the switches so the change applies at once. */
const forgetSwitches = () => { cache = { at: 0, switches: null }; };

/** Is this service configured and switched on? */
async function isActive(name) {
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
  out.hitpay.webhook = hitpayWebhookConfigured();
  out.hitpay.sandbox = hitpaySandbox();
  return out;
}

/** Safe, public values the admin login page needs. */
async function publicConfig() {
  return {
    googleClientId: (await isActive('googleSignIn')) ? env('GOOGLE_CLIENT_ID') : '',
    turnstileSiteKey: (await isActive('turnstile')) ? env('TURNSTILE_SITE_KEY') : '',
    // read-only flags so customer pages know what to show; changing them is admin-only
    features: {
      payOnline: await isActive('hitpay'),
      map: await isActive('maps'),
      weather: await isActive('weather'),
      addToCalendar: await isActive('googleCalendar'),
      sms: await isActive('sms'),
      email: await isActive('email'),
      qrCheckin: await isActive('qrCheckin'),
    },
  };
}

module.exports = { env, NAMES, LABELS, configured, isActive, status, publicConfig, forgetSwitches, hitpayWebhookConfigured, hitpaySandbox };
