const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
  console.error('Missing JWT_SECRET or MONGO_URI in .env');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
   const { startReminders } = require('./utils/reminders');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const courtRoutes = require('./routes/courtRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const adminRoutes = require('./routes/adminRoutes');
const engageRoutes = require('./routes/engageRoutes');
const { startReminderJob } = require('./utils/reminders');

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

// Slow down password guessing on login / register / forgot-password / admin-login
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { success: false, message: 'Too many attempts, try again later' },
  })
);

// Serve the frontend pages and assets.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// API routes
app.use('/api/auth', authRoutes);           // UF-101..104, AF-101
app.use('/api/users', userRoutes);          // UF-105..107, AF-103, AF-104
app.use('/api/dashboard', dashboardRoutes); // UF-108
app.use('/api/courts', courtRoutes);        // UF-109..115
app.use('/api/bookings', bookingRoutes);    // UF-116..122
app.use('/api/admin', adminRoutes);
app.use('/api', require('./routes/publicIntegrationRoutes')); // login-page config + HitPay webhook (no login)
app.use('/api', engageRoutes);              // UF-130, UF-131, UF-133, UF-134         // AF-102, AF-105..AF-135

const PORT = process.env.PORT || 5000;
<<<<<<< HEAD:backend/server.js
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

startReminderJob(); // UF-129: reminders 2 hours before each confirmed booking
=======
   app.listen(PORT, () => {
     console.log(`Server running on http://localhost:${PORT}`);
     startReminders(); // 2-hour booking reminders
   });
>>>>>>> a7268bdf5982b171a935f488c3beb16a426aba2c:server.js
