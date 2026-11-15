/**
 * Optional, one-off: gives records created before timestamp concurrency control a write timestamp.
 * The system already works without this (a missing writeTS is treated as "version null" and still
 * validated), but after running it every record shows its own version in the API.
 *
 *   node scripts/backfillWriteTS.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MODELS = ['Announcement', 'BlockedSlot', 'Booking', 'Court', 'Feedback', 'Issue', 'Notification', 'Promotion', 'Settings', 'User'];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  for (const name of MODELS) {
    const Model = require(`../models/${name}`);
    // straight to the driver: we want writeTS = the record's own last update time, not "now"
    const r = await Model.collection.updateMany(
      { writeTS: { $exists: false } },
      [{ $set: { writeTS: { $ifNull: ['$updatedAt', '$$NOW'] } } }]
    );
    console.log(`${name}: ${r.modifiedCount} record(s) stamped`);
  }
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
