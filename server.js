require('dotenv').config();

if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
  console.error('Missing JWT_SECRET or MONGO_URI in .env');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const connectDB = require('./config/db');
   const { startReminders } = require('./utils/reminders');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const courtRoutes = require('./routes/courtRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const adminRoutes = require('./routes/adminRoutes');
const engageRoutes = require('./routes/engageRoutes');

connectDB();

const app = express();

app.use(helmet({ contentSecurityPolicy: false })); // CSP off: pages use inline scripts
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
app.use(express.json({ limit: '1mb' }));

// Slow down password guessing on login / register / forgot-password / admin-login
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { success: false, message: 'Too many attempts, try again later' },
  })
);

// Serve the frontend (public/*.html, css, js, admin pages)
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRoutes);           // UF-101..104, AF-101
app.use('/api/users', userRoutes);          // UF-105..107, AF-103, AF-104
app.use('/api/dashboard', dashboardRoutes); // UF-108
app.use('/api/courts', courtRoutes);        // UF-109..115
app.use('/api/bookings', bookingRoutes);    // UF-116..122
app.use('/api/admin', adminRoutes);
app.use('/api', engageRoutes);              // UF-130, UF-131, UF-133, UF-134         // AF-102, AF-105..AF-135

const PORT = process.env.PORT || 5000;
   app.listen(PORT, () => {
     console.log(`Server running on http://localhost:${PORT}`);
     startReminders(); // 2-hour booking reminders
   });