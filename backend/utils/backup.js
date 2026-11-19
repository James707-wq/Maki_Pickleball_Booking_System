/**
 * AF-138 Backup and restore.
 *
 * A backup is one JSON file holding every record of the app, written as MongoDB Extended JSON so ids, dates and
 * numbers come back exactly as they were. Files live in backend/backups/ (or BACKUP_DIR), never in git: they hold
 * customers' details and password hashes, so keep downloaded copies somewhere safe.
 *
 * Not in a backup: sessions (who is signed in), one-time codes, and this server's .env fingerprints.
 *
 * Restoring replaces every collection the backup has with the backup's records. A safety backup of the data as it
 * was is made first; when MongoDB can't run it as one transaction (a single local server) and something fails half
 * way, the safety copy is written back. Automatic backups: one a day while Settings.backup.auto is on, keeping the
 * newest Settings.backup.keep of them.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;
const FORMAT = 'makis-pickleball-backup';
const VERSION = 1;
const KINDS = ['manual', 'auto', 'before-restore', 'uploaded'];
const NAME_RE = /^makis-backup-\d{8}-\d{6}-(manual|auto|before-restore|uploaded)(-\d{1,3})?\.json$/;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** model name -> what admins call it. The order is the order they are restored in. */
const PARTS = [
  ['User', 'Accounts'], ['Court', 'Courts'], ['Settings', 'Settings'], ['Booking', 'Bookings'], ['BlockedSlot', 'Blocked time slots'],
  ['Transaction', 'Transactions'], ['Promotion', 'Promotions'], ['Announcement', 'Announcements'], ['Notification', 'Notifications'],
  ['Feedback', 'Feedback'], ['Issue', 'Issues'], ['AuditLog', 'Audit logs'], ['LoginAttempt', 'Sign-in history'],
  ['ApiToken', 'API tokens'], ['WebhookDelivery', 'Custom API log'],
];

/** [{ model, name (collection), label }] */
function parts() {
  return PARTS.map(([model, label]) => {
    const M = require(`../models/${model}`);
    return { model, name: M.collection.collectionName, label };
  });
}
const labelOf = (name) => (parts().find((p) => p.name === name) || { label: name }).label;

const BACKEND_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.resolve(BACKEND_DIR, '..', 'frontend'); // served to everyone by express.static
/** Would this folder (BACKUP_DIR, relative to backend/) put backups where anyone can download them? */
const insidePublic = (folder) => {
  const p = path.resolve(BACKEND_DIR, String(folder || ''));
  return p === PUBLIC_DIR || p.startsWith(PUBLIC_DIR + path.sep);
};
/** The backups folder: BACKUP_DIR (relative to backend/) or backend/backups. Never inside the public frontend folder. */
const dir = () => {
  const folder = process.env.BACKUP_DIR ? path.resolve(BACKEND_DIR, process.env.BACKUP_DIR) : path.join(BACKEND_DIR, 'backups');
  if (insidePublic(folder)) throw new BackupError('BACKUP_DIR in backend/.env is inside the frontend folder, which anyone can download from. Choose another folder and restart the server.', 500);
  return folder;
};
const fileOf = (name) => path.join(dir(), name);
const metaOf = (name) => path.join(dir(), `${name}.meta.json`);
const isName = (name) => typeof name === 'string' && NAME_RE.test(name);
const nameOf = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
const manilaStamp = (d) => new Date(d.getTime() + 8 * 3600e3).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261117-020000
const when = (d) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });

class BackupError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'BackupError'; this.status = status; }
}

async function ensureDir() {
  await fsp.mkdir(dir(), { recursive: true });
}

/** A file name not used yet for this time and kind. */
async function freeName(date, kind) {
  const base = `makis-backup-${manilaStamp(date)}-${kind}`;
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${base}.json` : `${base}-${i}.json`;
    if (!fs.existsSync(fileOf(name))) return name;
  }
  throw new BackupError('Too many backups in the same second');
}

/** Every record of every part, straight from MongoDB (no app logic in between). */
async function snapshot() {
  const db = mongoose.connection.db;
  if (!db || mongoose.connection.readyState !== 1) throw new BackupError('The database is not connected', 503);
  const collections = {};
  const counts = {};
  for (const p of parts()) {
    const docs = await db.collection(p.name).find({}).toArray();
    collections[p.name] = docs;
    counts[p.name] = docs.length;
  }
  return { collections, counts };
}

/** Writes the file (temp file + rename, so a half-written backup never shows up) and its small description. */
async function writeBackup(name, text, meta) {
  await ensureDir();
  const tmp = fileOf(`${name}.tmp`);
  await fsp.writeFile(tmp, text, { mode: 0o600 });
  await fsp.rename(tmp, fileOf(name));
  await fsp.writeFile(metaOf(name), JSON.stringify(meta, null, 2), { mode: 0o600 });
  return meta;
}

const describeCounts = (counts) => Object.entries(counts || {}).map(([name, n]) => ({ name, label: labelOf(name), count: n }));

/** Makes a backup now. kind: manual | auto | before-restore. Returns its description (and the data, for restore). */
async function create({ kind = 'manual', by = null } = {}) {
  if (!KINDS.includes(kind) || kind === 'uploaded') throw new BackupError('Unknown backup kind');
  const { collections, counts } = await snapshot();
  const createdAt = new Date();
  const doc = { format: FORMAT, version: VERSION, app: "MAKI's PickleBall Court", createdAt, kind, createdBy: nameOf(by), counts, collections };
  const text = EJSON.stringify(doc, { relaxed: false });
  const name = await freeName(createdAt, kind);
  const meta = {
    name, kind, version: VERSION, createdAt: createdAt.toISOString(), createdBy: nameOf(by), counts,
    size: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex'),
  };
  await writeBackup(name, text, meta);
  return { meta, collections };
}

/**
 * Is this a backup we can restore? Returns { problems } or { counts, missing }.
 * Refuses files of another app, of a newer version, with unknown parts, or without an active admin account
 * (restoring that would lock everyone out of the admin console).
 */
function validate(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || doc.format !== FORMAT) return { problems: ["This is not a backup file of MAKI's PickleBall Court"] };
  // read in canonical mode, numbers keep their exact BSON type (Int32, Double...): Number() turns the header's into plain numbers
  const version = Number(doc.version);
  if (!Number.isInteger(version) || version < 1) problems.push('The backup has no valid version number');
  else if (version > VERSION) problems.push('This backup was made by a newer version of the app. Update the app first.');
  const cols = doc.collections;
  if (!cols || typeof cols !== 'object' || Array.isArray(cols)) return { problems: [...problems, 'The backup has no records in it'] };
  const known = new Map(parts().map((p) => [p.name, p]));
  const counts = {};
  Object.entries(cols).forEach(([name, docs]) => {
    if (!known.has(name)) { problems.push(`Unknown part "${String(name).slice(0, 40)}"`); return; }
    if (!Array.isArray(docs)) { problems.push(`${known.get(name).label}: not a list of records`); return; }
    const broken = docs.findIndex((d) => !d || typeof d !== 'object' || Array.isArray(d) || d._id === undefined);
    if (broken >= 0) { problems.push(`${known.get(name).label}: record ${broken + 1} is damaged (no id)`); return; }
    const ids = new Set(docs.map((d) => EJSON.stringify(d._id)));
    if (ids.size !== docs.length) problems.push(`${known.get(name).label}: ${docs.length - ids.size} record(s) have the same id as another`);
    counts[name] = docs.length;
  });
  const users = Array.isArray(cols.users) ? cols.users : [];
  if (!users.length) problems.push('The backup has no accounts. Restoring it would lock everyone out');
  else if (!users.some((u) => u.role === 'admin' && u.isActive !== false)) problems.push('The backup has no active admin account, so nobody could sign in to the admin console afterwards');
  if (problems.length) return { problems };
  const missing = parts().filter((p) => !(p.name in cols)).map((p) => p.label);
  return { counts, missing };
}

/** Reads and checks a saved backup. */
async function read(name) {
  if (!isName(name)) throw new BackupError('Backup not found', 404);
  let text;
  try { text = await fsp.readFile(fileOf(name), 'utf8'); } catch (err) { throw new BackupError('Backup not found', 404); }
  let doc;
  try { doc = EJSON.parse(text, { relaxed: false }); } catch (err) { throw new BackupError('The backup file is damaged (it is not valid JSON)'); }
  const v = validate(doc);
  if (v.problems) throw new BackupError(`${v.problems.join('. ')}.`);
  return { doc, text, check: v };
}

/** The description of one backup: its .meta.json, or worked out from the file when that is missing. */
async function metaFor(name) {
  try {
    const meta = JSON.parse(await fsp.readFile(metaOf(name), 'utf8'));
    if (meta && meta.name === name) return meta;
  } catch (err) { /* no description yet: read the file */ }
  try {
    const { doc, text } = await read(name);
    const meta = {
      name, kind: name.match(NAME_RE)[1], version: Number(doc.version), createdAt: new Date(doc.createdAt).toISOString(), createdBy: doc.createdBy || '',
      counts: Object.fromEntries(Object.entries(doc.collections).map(([k, v]) => [k, v.length])),
      size: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex'),
    };
    await fsp.writeFile(metaOf(name), JSON.stringify(meta, null, 2), { mode: 0o600 }).catch(() => {});
    return meta;
  } catch (err) {
    const stat = await fsp.stat(fileOf(name)).catch(() => null);
    return { name, kind: (name.match(NAME_RE) || [])[1] || 'manual', damaged: err.message, size: stat ? stat.size : 0, createdAt: stat ? stat.mtime.toISOString() : null, counts: {} };
  }
}

/** Every backup on the server, newest first. */
async function list() {
  const folder = dir(); // a folder that is not allowed is an error, not an empty list
  let names = [];
  try { names = (await fsp.readdir(folder)).filter(isName); } catch (err) { return []; }
  const metas = await Promise.all(names.map(metaFor));
  return metas.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** A backup as the admin page shows it. */
const view = (m) => ({
  name: m.name, kind: m.kind, createdAt: m.createdAt, createdBy: m.createdBy || '', size: m.size || 0, damaged: m.damaged || '',
  records: Object.values(m.counts || {}).reduce((s, n) => s + n, 0), parts: describeCounts(m.counts),
});

/** Removes a saved backup and its description. */
async function remove(name) {
  if (!isName(name)) throw new BackupError('Backup not found', 404);
  try { await fsp.unlink(fileOf(name)); } catch (err) { throw new BackupError('Backup not found', 404); }
  await fsp.unlink(metaOf(name)).catch(() => {});
}

/** Saves an uploaded backup file (checked first) so it can be restored like the others. */
async function saveUploaded(buffer, { by = null } = {}) {
  if (!buffer || !buffer.length) throw new BackupError('The file is empty');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new BackupError('The file is larger than 100 MB', 413);
  const text = buffer.toString('utf8');
  let doc;
  try { doc = EJSON.parse(text, { relaxed: false }); } catch (err) { throw new BackupError('That file is not a backup (it is not valid JSON)'); }
  const v = validate(doc);
  if (v.problems) throw new BackupError(`${v.problems.join('. ')}.`);
  const name = await freeName(new Date(), 'uploaded');
  const meta = {
    name, kind: 'uploaded', version: Number(doc.version), createdAt: new Date(doc.createdAt || Date.now()).toISOString(),
    uploadedAt: new Date().toISOString(), createdBy: doc.createdBy || '', uploadedBy: nameOf(by), counts: v.counts,
    size: buffer.length, sha256: crypto.createHash('sha256').update(text).digest('hex'),
  };
  await writeBackup(name, text, meta);
  return { meta, missing: v.missing };
}

const noTransactions = (err) => Boolean(err) && (err.code === 20 || err.codeName === 'IllegalOperation'
  || /Transaction numbers are only allowed|replica set|does not support transactions/i.test(String(err.message)));

/** Replaces the given collections with `data` (inside `session` when given). An error says which part failed. */
async function writeAll(data, names, session) {
  const db = mongoose.connection.db;
  for (const name of names) {
    try {
      const opts = session ? { session } : {};
      await db.collection(name).deleteMany({}, opts);
      const docs = data[name] || [];
      for (let i = 0; i < docs.length; i += 1000) await db.collection(name).insertMany(docs.slice(i, i + 1000), { ...opts, ordered: true });
    } catch (err) {
      err.part = name;
      throw err;
    }
  }
}

/** Which fields a duplicate-key error is about. insertMany puts the details on its first write error. */
function dupFields(err) {
  const first = Array.isArray(err.writeErrors) ? err.writeErrors[0] : err.writeErrors;
  const kv = err.keyValue || (first && (first.keyValue || (first.err && first.err.keyValue)));
  if (kv && Object.keys(kv).length) return Object.keys(kv).map((k) => (k === '_id' ? 'id' : k));
  const msg = String((first && (first.errmsg || (first.err && first.err.errmsg))) || err.message || '');
  const m = msg.match(/index: (\S+) dup key/);
  if (!m) return [];
  if (m[1] === '_id_') return ['id'];
  if (m[1] === 'unique_active_slot') return ['court, date and start time'];
  return [m[1].replace(/_-?1(?=_|$)/g, ' ').trim().split(/\s+/).join(' and ')];
}

/** A failed write in words an admin can act on (never the raw driver message with the database name). */
function whyFailed(err) {
  const part = err.part ? labelOf(err.part) : 'The data';
  if (err.code === 11000 || /E11000/.test(String(err.message))) {
    const words = { referenceNumber: 'reference number', email: 'email', code: 'code', key: 'key', hash: 'token' };
    const fields = dupFields(err).map((f) => words[f] || f);
    return `${part}: two records have the same ${fields.length ? fields.join(' and ') : 'value'}`;
  }
  return `${part}: ${String(err.message || err).replace(/collection: \S+/g, '').slice(0, 160)}`;
}

/**
 * Restores a saved backup. Returns { safety (the backup of the data as it was), counts, missing, transaction }.
 * Afterwards the caller ends the sessions that should no longer be open.
 */
async function restore(name, { by = null } = {}) {
  const { doc, check } = await read(name);
  const names = parts().map((p) => p.name).filter((n) => n in doc.collections); // restore order
  const safety = await create({ kind: 'before-restore', by });

  let transaction = false;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => writeAll(doc.collections, names, session));
    transaction = true;
  } catch (err) {
    if (!noTransactions(err)) {
      await session.endSession().catch(() => {});
      throw new BackupError(`The restore failed and nothing was changed (${whyFailed(err)}).`, 500);
    }
  }
  await session.endSession().catch(() => {});

  if (!transaction) {
    // a single MongoDB server can't run transactions: write part by part, and put everything back if one fails
    try {
      await writeAll(doc.collections, names, null);
    } catch (err) {
      console.error('Restore failed, putting the data back:', err.message);
      try {
        await writeAll(safety.collections, names, null);
      } catch (rollbackErr) {
        console.error('Putting the data back failed:', rollbackErr.message);
        throw new BackupError(`The restore failed (${whyFailed(err)}) and putting the data back failed too (${whyFailed(rollbackErr)}). Restore "${safety.meta.name}" to get back the data from before.`, 500);
      }
      throw new BackupError(`The restore failed and the data was put back as it was (${whyFailed(err)}).`, 500);
    }
  }
  try { require('./integrations').forgetSwitches(); } catch (err) { /* cache only */ }
  return { safety: safety.meta, counts: check.counts, missing: check.missing, transaction, restoredFrom: doc.createdAt };
}

/** Keeps the newest `keep` automatic backups and removes older ones. Returns the names removed. */
async function prune(keep) {
  const autos = (await list()).filter((m) => m.kind === 'auto');
  const old = autos.slice(Math.max(Number(keep) || 7, 1));
  for (const m of old) await remove(m.name).catch(() => {});
  return old.map((m) => m.name);
}

let job = null;
let running = false;
/** One automatic backup a day while it is on (checked every 30 minutes, first 2 minutes after the start). */
async function autoBackupDue() {
  if (running || mongoose.connection.readyState !== 1) return null;
  running = true;
  try {
    const Settings = require('../models/Settings');
    const s = await Settings.get();
    if (!s.backup || s.backup.auto === false) return null;
    const newest = (await list()).find((m) => m.kind === 'auto' && !m.damaged);
    if (newest && Date.now() - new Date(newest.createdAt).getTime() < 23.5 * 3600e3) return null;
    const { meta } = await create({ kind: 'auto' });
    const removed = await prune(s.backup.keep);
    console.log(`Automatic backup saved: ${meta.name}${removed.length ? ` (removed ${removed.length} older)` : ''}`);
    return meta;
  } catch (err) {
    console.error('Automatic backup failed:', err.message);
    return null;
  } finally {
    running = false;
  }
}
function startBackupJob() {
  if (job) return;
  const first = setTimeout(autoBackupDue, 2 * 60 * 1000);
  job = setInterval(autoBackupDue, 30 * 60 * 1000);
  first.unref(); job.unref();
}

module.exports = {
  FORMAT, VERSION, KINDS, NAME_RE, MAX_UPLOAD_BYTES, BackupError,
  parts, labelOf, dir, insidePublic, isName, fileOf, create, validate, read, list, view, remove, saveUploaded, restore, prune,
  autoBackupDue, startBackupJob, describeCounts, when,
};
