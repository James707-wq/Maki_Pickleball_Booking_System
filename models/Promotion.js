const mongoose = require('mongoose');

/** AF-127 Promotions and Discounts (shown to customers as UF-131, applied at booking). */
const PromotionSchema = new mongoose.Schema(
  {
    code: { type: String, required: [true, 'Promo code is required'], unique: true, uppercase: true, trim: true, match: [/^[A-Z0-9_-]{3,20}$/, 'Code must be 3-20 letters, numbers, - or _'] },
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 100 },
    description: { type: String, trim: true, default: '', maxlength: 500 },
    type: { type: String, enum: ['percent', 'fixed'], required: true },
    value: { type: Number, required: true, min: [1, 'Discount must be at least 1'] },
    startsAt: { type: Date }, // Manila midnight, inclusive
    endsAt: { type: Date },   // Manila end of day, inclusive
    usageLimit: { type: Number, min: 0, default: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

PromotionSchema.pre('validate', function (next) {
  if (this.type === 'percent' && this.value > 100) this.invalidate('value', 'A percentage discount cannot be more than 100');
  next();
});

/** Is this promo usable right now? Returns an error message or null. */
PromotionSchema.methods.problem = function (now = new Date()) {
  if (!this.active) return 'This promo is not active';
  if (this.startsAt && now < this.startsAt) return 'This promo has not started yet';
  if (this.endsAt && now > this.endsAt) return 'This promo has ended';
  if (this.usageLimit && this.usedCount >= this.usageLimit) return 'This promo has been fully used';
  return null;
};

PromotionSchema.methods.discountFor = function (fee) {
  const d = this.type === 'percent' ? Math.round((fee * this.value) / 100) : this.value;
  return Math.min(Math.max(d, 0), fee);
};

module.exports = mongoose.model('Promotion', PromotionSchema);
