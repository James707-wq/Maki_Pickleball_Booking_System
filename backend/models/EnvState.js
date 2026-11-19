const mongoose = require('mongoose');

/**
 * What backend/.env looked like at the last server start (utils/envCheck.js), so the next start can tell the admins
 * what changed. It never holds a value: only a salted scrypt fingerprint of each one (slow on purpose, so this
 * document can't be used to guess values), which services were set up, and the problems already reported.
 */
const EnvStateSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true },
    salt: { type: String, required: true },
    fingerprints: { type: mongoose.Schema.Types.Mixed, default: {} }, // KEY -> fingerprint ('' = not set)
    services: { type: mongoose.Schema.Types.Mixed, default: {} },     // googleSignIn -> set up at the last start?
    problems: { type: [String], default: [] },                        // problems already reported (not repeated)
    lastChanges: { type: [String], default: [] },                     // what changed at the last start that changed something
    changedAt: { type: Date },
    checkedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EnvState', EnvStateSchema);
