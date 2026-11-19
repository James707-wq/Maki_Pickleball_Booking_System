const mongoose = require('mongoose');

/**
 * One event for the custom API (webhook), saved before it is sent so retries survive a restart
 * (utils/integrations/webhook.js). `body` is the exact JSON that is signed and POSTed: every try sends
 * the same bytes. MongoDB deletes deliveries 30 days after they were made.
 */
const WebhookDeliverySchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },     // evt_..., also sent as X-Webhook-Id
    type: { type: String, required: true },                       // booking.approved, webhook.test, ...
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    test: { type: Boolean, default: false },
    body: { type: String, required: true },
    verify: { type: mongoose.Schema.Types.Mixed, default: null }, // what changed, to spot a save that was undone
    status: { type: String, enum: ['pending', 'sending', 'delivered', 'failed', 'skipped'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lastAttemptAt: { type: Date },
    responseStatus: { type: Number },
    responseBody: { type: String, default: '' },                  // the start of the answer, for troubleshooting
    error: { type: String, default: '' },
    durationMs: { type: Number },
    deliveredAt: { type: Date },
  },
  { timestamps: true }
);
WebhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });
WebhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('WebhookDelivery', WebhookDeliverySchema);
