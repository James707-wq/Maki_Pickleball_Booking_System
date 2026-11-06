/**
 * Creates the first administrator (or promotes an existing account to admin).
 *
 *   npm run create:admin -- admin@example.com "StrongPassw0rd" "Maki" "Owner"
 *
 * or with env vars: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, ADMIN_LAST_NAME
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const [argEmail, argPassword, argFirst, argLast] = process.argv.slice(2);
const email = (argEmail || process.env.ADMIN_EMAIL || '').toLowerCase();
const password = argPassword || process.env.ADMIN_PASSWORD;
const firstName = argFirst || process.env.ADMIN_FIRST_NAME || 'Admin';
const lastName = argLast || process.env.ADMIN_LAST_NAME || 'User';

(async () => {
  try {
    if (!email || !password) {
      console.error('Usage: npm run create:admin -- <email> <password> [firstName] [lastName]');
      process.exit(1);
    }
    if (password.length < 8) {
      console.error('Password must be at least 8 characters');
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);

    let user = await User.findOne({ email });
    if (user) {
      user.role = 'admin';
      user.isActive = true;
      await user.save();
      console.log(`Existing account ${email} is now an admin (password unchanged).`);
    } else {
      user = await User.create({ firstName, lastName, email, password, role: 'admin' });
      console.log(`Admin account created: ${email}`);
    }
    console.log('Log in at /admin-login.html');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
