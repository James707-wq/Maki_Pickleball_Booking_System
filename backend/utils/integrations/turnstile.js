/** Cloudflare Turnstile: bot check on the admin sign-in form. Skipped when not configured. */
const { env, isActive } = require('./index');

async function verifyTurnstile(token, ip) {
  if (!(await isActive('turnstile'))) return { ok: true, skipped: true };
  if (!token) return { ok: false, message: 'Please complete the "verify you are human" check' };
  try {
    const body = new URLSearchParams({ secret: env('TURNSTILE_SECRET_KEY'), response: String(token) });
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    return data.success ? { ok: true } : { ok: false, message: 'The human check failed or expired. Please try again.' };
  } catch (err) {
    console.error('Turnstile check failed:', err.message);
    return { ok: false, message: 'Could not run the human check right now. Please try again.' };
  }
}

module.exports = { verifyTurnstile };
