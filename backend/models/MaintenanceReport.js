const mongoose = require('mongoose');
const { timestampConcurrency } = require('../utils/concurrency');

/**
 * SF-122 Maintenance Reporting: a problem staff found (damaged equipment, the court surface, the lights...),
 * reported to the administrators. Admins set it in progress or fixed; every step is kept in `updates`.
 */
const CATEGORIES = ['court', 'net', 'lighting', 'equipment', 'facility', 'cleaning', 'other'];

const MaintenanceReportSchema = new mongoose.Schema(
  {
    court: { type: mongoose.Schema.Types.ObjectId, ref: 'Court' }, // none: not about one court (e.g. the restroom)
    courtName: { type: String, trim: true, default: '' },
    category: { type: String, enum: CATEGORIES, required: true },
    severity: { type: String, enum: ['low', 'normal', 'urgent'], default: 'normal' },
    title: { type: String, required: [true, 'Say in a few words what is wrong'], trim: true, maxlength: 100 },
    details: { type: String, trim: true, default: '', maxlength: 2000 },
    status: { type: String, enum: ['open', 'in_progress', 'fixed'], default: 'open' },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedByName: { type: String, default: '' },
    updates: [{
      byName: { type: String, default: '' },
      byRole: { type: String, default: '' },
      message: { type: String, trim: true, default: '', maxlength: 1000 },
      status: { type: String, default: '' }, // the status it was set to, when this update changed it
      at: { type: Date, default: Date.now },
    }],
    fixedAt: { type: Date },
    fixedByName: { type: String, default: '' },
  },
  { timestamps: true }
);
MaintenanceReportSchema.index({ status: 1, createdAt: -1 });
MaintenanceReportSchema.plugin(timestampConcurrency);

module.exports = mongoose.model('MaintenanceReport', MaintenanceReportSchema);
module.exports.CATEGORIES = CATEGORIES;
