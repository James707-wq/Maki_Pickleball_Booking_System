const mongoose = require('mongoose');

/** Facility-wide settings (single document) - AF-112 Operating Hours. Bookings always need approval (AF-116). */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true },
    openTime: { type: String, default: '06:00' },
    closeTime: { type: String, default: '22:00' },
    // facility location, picked on the admin map (Leaflet + OpenStreetMap); drives the weather forecast
    facilityLat: { type: Number, default: null, min: -90, max: 90 },
    facilityLng: { type: Number, default: null, min: -180, max: 180 },
    facilityAddress: { type: String, trim: true, default: '', maxlength: 200 },
    // admin on/off switches for the integrations (a service also needs its keys in backend/.env)
    integrationSwitches: {
      googleSignIn: { type: Boolean, default: true },
      googleCalendar: { type: Boolean, default: true },
      turnstile: { type: Boolean, default: true },
      hitpay: { type: Boolean, default: true },
      maps: { type: Boolean, default: true },
      weather: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      qrCheckin: { type: Boolean, default: true },
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

module.exports = mongoose.model('Settings', SettingsSchema);
