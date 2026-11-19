/**
 * Seals small secrets that have to live in MongoDB (the custom API's signing secret), so a copy of the
 * database alone does not give them away. AES-256-GCM with a key derived from JWT_SECRET.
 * If JWT_SECRET changes, sealed secrets can no longer be opened: open() returns '' and the admin makes a
 * new one under Integrations.
 */
const crypto = require('crypto');

const key = () => crypto.createHash('sha256').update(`secret-box:v1:${process.env.JWT_SECRET || ''}`).digest();

/** 'v1:<iv>:<tag>:<data>' (base64 parts). */
function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** The plain text, or '' when there is nothing sealed or it can't be opened. Never throws. */
function open(sealed) {
  const [v, iv, tag, data] = String(sealed || '').split(':');
  if (v !== 'v1' || !iv || !tag || data === undefined) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    return ''; // sealed with another JWT_SECRET, or damaged
  }
}

module.exports = { seal, open };
