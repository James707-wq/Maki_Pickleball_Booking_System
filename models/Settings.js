const mongoose = require('mongoose');

/** Facility-wide settings (single document) - AF-112 Operating Hours, AF-116 approval rule. */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true },
    openTime: { type: String, default: '06:00' },
    closeTime: { type: String, default: '22:00' },
    requireApproval: { type: Boolean, default: false },
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
