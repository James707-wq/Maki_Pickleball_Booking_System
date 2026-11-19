/**
 * /api/v1, the API for other systems: who is calling (an API token from Security -> API tokens), what that token may
 * do, and its own rate limit. Answers { success: false, code, message } with:
 *   401 TOKEN_MISSING / TOKEN_INVALID / TOKEN_REVOKED / TOKEN_EXPIRED,  403 TOKEN_SCOPE,  429 RATE_LIMITED
 */
const rateLimit = require('express-rate-limit');
const ApiToken = require('../models/ApiToken');
const { hashToken, TOKEN_RE, SCOPES, WINDOWS, day } = require('../utils/apiTokens');

const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message });
const plainIp = (ip) => String(ip || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

/** Recognises "Authorization: Bearer mkp_..." and puts the token on req.apiToken. */
async function apiTokenAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!raw) return fail(res, 401, 'TOKEN_MISSING', 'Send an API token in the Authorization header: Bearer mkp_...');
    const t = TOKEN_RE.test(raw) ? await ApiToken.findOne({ hash: hashToken(raw) }) : null;
    if (!t) return fail(res, 401, 'TOKEN_INVALID', 'This API token is not valid');
    if (t.revokedAt) return fail(res, 401, 'TOKEN_REVOKED', `This API token was revoked on ${day(t.revokedAt)}`);
    if (t.expiresAt && t.expiresAt <= new Date()) return fail(res, 401, 'TOKEN_EXPIRED', `This API token expired on ${day(t.expiresAt)}`);
    req.apiToken = t;
    if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60e3) { // at most one write a minute per token
      ApiToken.updateOne({ _id: t._id }, { $set: { lastUsedAt: new Date(), lastUsedIp: plainIp(req.ip) } }).catch(() => {});
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Only for tokens that were given `scope`. */
const requireScope = (scope) => (req, res, next) => (req.apiToken.scopes.includes(scope)
  ? next()
  : fail(res, 403, 'TOKEN_SCOPE', `This API token may not ${SCOPES[scope].can}. An admin can make a token that may (${scope}).`));

const human = (s) => (s < 60 ? `${s} second${s === 1 ? '' : 's'}` : s < 3600 ? `${Math.ceil(s / 60)} minutes` : `${Math.ceil(s / 3600)} hours`);

/** Each token's own rate limit: one limiter per window length (made once, here), the count per token. */
const limiters = Object.fromEntries(Object.entries(WINDOWS).map(([window, seconds]) => [window, rateLimit({
  windowMs: seconds * 1000,
  limit: (req) => req.apiToken.rateLimit.limit,
  keyGenerator: (req) => `token:${req.apiToken._id}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  requestPropertyName: 'rateLimit_token',
  handler: (req, res) => {
    const info = req.rateLimit_token || {};
    const reset = info.resetTime ? new Date(info.resetTime).getTime() : Date.now() + seconds * 1000;
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      success: false, code: 'RATE_LIMITED', limit: 'token', retryAfter,
      message: `This API token made too many requests (${req.apiToken.rateLimit.limit} per ${window}). Try again in ${human(retryAfter)}.`,
    });
  },
})]));
const tokenRateLimit = (req, res, next) => limiters[req.apiToken.rateLimit.window](req, res, next);

module.exports = { apiTokenAuth, requireScope, tokenRateLimit };
