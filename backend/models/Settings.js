const mongoose = require('mongoose');
const { timestampConcurrency } = require('../utils/concurrency');

/**
 * Facility-wide settings (single document) - AF-112 Operating Hours, AF-136 booking rules and payment settings,
 * AF-137 cancellation policy, AF-138 automatic backups. Bookings always need approval (AF-116).
 */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true },
    openTime: { type: String, default: '06:00' },
    closeTime: { type: String, default: '22:00' },
    // facility location, picked on the admin map (Leaflet + OpenStreetMap); drives the weather forecast
    facilityLat: { type: Number, default: null, min: -90, max: 90 },
    facilityLng: { type: Number, default: null, min: -180, max: 180 },
    facilityAddress: { type: String, trim: true, default: '', maxlength: 200 },
    // AF-136 booking rules, AF-137 cancellation and refund policy, and payment settings (utils/policy.js).
    // 0 always means "no limit" / "until the start time". Staff are never limited by these.
    rules: {
      maxAdvanceDays: { type: Number, default: 0, min: 0, max: 365 },
      minNoticeHours: { type: Number, default: 0, min: 0, max: 168 },
      maxUpcomingPerCustomer: { type: Number, default: 0, min: 0, max: 50 },
      cancelCutoffHours: { type: Number, default: 0, min: 0, max: 168 },
      rescheduleCutoffHours: { type: Number, default: 0, min: 0, max: 168 },
      fullRefundHours: { type: Number, default: 0, min: 0, max: 720 }, // 0 = always a full refund
      lateRefundPercent: { type: Number, default: 100, min: 0, max: 100 },
      policyNote: { type: String, trim: true, default: '', maxlength: 500 },
      paymentMethods: { type: [String], default: () => ['GCash', 'Maya', 'Bank transfer', 'Card', 'Other'] },
      paymentInstructions: { type: String, trim: true, default: '', maxlength: 600 },
    },
    // AF-138 automatic backups (utils/backup.js): one a day while on, keeping the newest `keep`
    backup: {
      auto: { type: Boolean, default: true },
      keep: { type: Number, default: 7, min: 1, max: 60 },
    },
    // admin on/off switches for the integrations (a service also needs its keys in backend/.env)
    integrationSwitches: {
      googleSignIn: { type: Boolean, default: true },
      googleCalendar: { type: Boolean, default: true },
      turnstile: { type: Boolean, default: true },
      maps: { type: Boolean, default: true },
      weather: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      qrCheckin: { type: Boolean, default: true },
      webhook: { type: Boolean, default: true },
    },
    // Custom API (webhook): booking events are POSTed, signed, to the facility's own system
    // (utils/integrations/webhook.js). Set under admin -> Integrations, not in backend/.env.
    webhook: {
      url: { type: String, trim: true, default: '', maxlength: 500 },
      secret: { type: String, default: '' },      // sealed with utils/secretBox.js; never sent to the browser
      secretHint: { type: String, default: '' },  // its last 4 characters, so admins can recognise it
      secretSetAt: { type: Date },
      events: { type: [String], default: [] },
      includeContact: { type: Boolean, default: false }, // the customer's email and mobile in each event
    },
  },
  { timestamps: true }
);

SettingsSchema.statics.get = async function () {
  try {
    return await this.findOneAndUpdate(
      { key: 'main' },
      { $setOnInsert: { key: 'main' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err.code === 11000) return this.findOne({ key: 'main' }); // two requests raced the first insert
    throw err;
  }
};

// Timestamp concurrency control: adds writeTS (W-TS) and makes every write validate it.
SettingsSchema.plugin(timestampConcurrency);

module.exports = mongoose.model('Settings', SettingsSchema);
