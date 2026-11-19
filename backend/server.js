const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
  console.error('Missing JWT_SECRET or MONGO_URI in .env');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimits = require('./middleware/rateLimits');
const connectDB = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const courtRoutes = require('./routes/courtRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const adminRoutes = require('./routes/adminRoutes');
const engageRoutes = require('./routes/engageRoutes');
const { startReminderJob } = require('./utils/reminders');
const { startWebhookJob } = require('./utils/integrations/webhook');
const { startBackupJob } = require('./utils/backup');
const envCheck = require('./utils/envCheck');

connectDB();

const app = express();

app.use(helmet({
  contentSecurityPolicy: false, // CSP off: pages use inline scripts
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Google Sign-In uses a popup
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },   // Google Sign-In checks the page's origin; "no-referrer" breaks it
}));
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || process.env.CLIENT_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin)
);
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
}));
// keep the raw body too: the HitPay webhook signature is computed over the exact bytes
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// Behind a proxy or load balancer (TRUST_PROXY=1), req.ip is the visitor's address instead of the proxy's
app.set('trust proxy', rateLimits.trustProxySetting(process.env.TRUST_PROXY));
// Rate limits for every API request (backend/.env RATE_LIMIT_AUTH, RATE_LIMIT_API, RATE_LIMIT_CREATE) + GET /api/rate-limit
rateLimits.setup(app);

// Serve the frontend pages and assets.
// Clean addresses for every page, customer site and admin alike: /my-bookings?status=cancelled, /admin#/audit?page=5.
// An address ending in .html (an old link, a bookmark, an emailed link) is sent to its clean form with the same
// ?query; the browser keeps the #part. The name allows only letters, digits, - and _, so it can't point elsewhere.
app.get(/^\/([A-Za-z0-9_-]+)\.html$/, (req, res) => {
  const name = req.params[0];
  const at = req.originalUrl.indexOf('?');
  res.redirect(302, `${name === 'index' ? '/' : `/${name}`}${at >= 0 ? req.originalUrl.slice(at) : ''}`);
});
// extensions: /admin opens admin.html, /courts opens courts.html
app.use(express.static(path.join(__dirname, '..', 'frontend'), { extensions: ['html'] }));

// API routes
app.use('/api/auth', authRoutes);           // UF-101..104, AF-101
app.use('/api/users', userRoutes);          // UF-105..107, AF-103, AF-104
app.use('/api/dashboard', dashboardRoutes); // UF-108
app.use('/api/courts', courtRoutes);        // UF-109..115
app.use('/api/bookings', bookingRoutes);    // UF-116..122
app.use('/api/admin', adminRoutes);
app.use('/api/v1', require('./routes/apiV1Routes')); // the API for other systems, with an API token (before the /api routers below)
app.use('/api', require('./routes/publicIntegrationRoutes')); // login-page config + HitPay webhook (no login)
app.use('/api', engageRoutes);              // UF-130, UF-131, UF-133, UF-134         // AF-102, AF-105..AF-135

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

startReminderJob(); // UF-129: reminders 2 hours before each confirmed booking
startWebhookJob();  // custom API (webhook): retries for booking events not delivered yet
startBackupJob();   // AF-138: one automatic backup a day (admin -> Backup & restore)
envCheck.start();   // backend/.env: tell the admins what changed since the last start, values that can't work, and edits
