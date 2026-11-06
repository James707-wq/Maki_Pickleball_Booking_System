const mongoose = require('mongoose');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Court schema - customer side UF-109..UF-115, admin side AF-108..AF-113.
 */
const CourtSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Court name is required'], trim: true },
    courtNumber: { type: String, trim: true },
    location: { type: String, required: [true, 'Location is required'], trim: true },
    description: { type: String, trim: true, default: '' },
    facilities: [{ type: String, trim: true }],
    pricePerHour: { type: Number, required: [true, 'Price is required'], min: [0, 'Price cannot be negative'] },
    status: {
      type: String,
      enum: ['available', 'unavailable', 'maintenance', 'closed'],
      default: 'available',
    },
    openTime: { type: String, default: '06:00', match: [HHMM, 'Open time must be HH:MM'] },
    closeTime: { type: String, default: '22:00', match: [HHMM, 'Close time must be HH:MM'] },
    slotDurationMinutes: {
      type: Number,
      default: 60,
      min: [15, 'Slot length must be at least 15 minutes'],
      max: [240, 'Slot length cannot exceed 240 minutes'],
    },
    imageUrl: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Court', CourtSchema);
