
const MAX_ATTEMPTS = 3;

/* ------------------------------------------------------------------ */
/* 1. Timestamp generator                                              */
/* ------------------------------------------------------------------ */
// Strictly increasing within this server process, even when two calls land in the same millisecond
// or the system clock is moved backwards. This is what makes the timestamps unique and ordered.
let lastIssued = 0;
function nextTimestamp() {
  const now = Date.now();
  lastIssued = now > lastIssued ? now : lastIssued + 1;
  return new Date(lastIssued);
}

/* ------------------------------------------------------------------ */
/* 2. Conflict error                                                   */
/* ------------------------------------------------------------------ */
class WriteConflictError extends Error {
  /**
   * @param {string} message  shown to the user
   * @param {object} opts
   *   retryable       true  -> the request is restarted with a new timestamp (the person never saw the old data)
   *                   false -> the person acted on an old version; tell them to reload
   *   currentWriteTS  W-TS of the record as it is now, so the client can reload it
   */
  constructor(message, { retryable = true, currentWriteTS = null } = {}) {
    super(message);
    this.name = 'WriteConflictError';
    this.status = 409;
    this.code = 'WRITE_CONFLICT';
    this.retryable = retryable;
    this.currentWriteTS = currentWriteTS;
  }
}

const isConflict = (err) => err && err.name === 'WriteConflictError';

/* ------------------------------------------------------------------ */
/* 3. Mongoose plugin: W-TS on every record                            */
/* ------------------------------------------------------------------ */
/** Field names an update touches (ignoring updatedAt, which Mongoose adds itself). */
function touchedFields(update) {
  const out = new Set();
  Object.keys(update || {}).forEach((k) => {
    if (k.startsWith('$')) Object.keys(update[k] || {}).forEach((f) => out.add(f.split('.')[0]));
    else out.add(k.split('.')[0]);
  });
  out.delete('updatedAt');
  out.delete('createdAt');
  return out;
}

/**
 * Adds `writeTS` to a schema and enforces the validation rule on every write path Mongoose has:
 *  - doc.save()                 -> conditional on the W-TS that was read (throws WriteConflictError)
 *  - updateOne/updateMany/
 *    findOneAndUpdate/replaceOne -> stamp a fresh W-TS so readers holding an older one are invalidated
 *
 * options.ignore: fields that are bookkeeping only. An update that touches nothing else leaves W-TS alone
 * (used for Court.scheduleTS, so a booking does not make an admin's open court form "stale").
 */
function timestampConcurrency(schema, options = {}) {
  const ignore = new Set(options.ignore || []);
  schema.add({ writeTS: { type: Date } });

  // Read phase: remember the W-TS this copy of the record was read at.
  schema.post('init', function () {
    this.$locals.writeTSKnown = this.isSelected('writeTS') !== false;
    this.$locals.readWriteTS = this.writeTS || null;
  });

  // Validation + write phase for doc.save()
  schema.pre('save', function () {
    const seen = this.$locals.readWriteTS || null;
    let ts = nextTimestamp();
    if (seen && ts <= seen) ts = new Date(seen.getTime() + 1); // W-TS must always move forward
    if (!this.isNew && this.$locals.writeTSKnown !== false) {
      // { writeTS: null } also matches records written before this feature existed
      this.$where = { ...(this.$where || {}), writeTS: seen };
    }
    this.writeTS = ts;
  });

  schema.post('save', function () {
    this.$locals.readWriteTS = this.writeTS;
    this.$locals.writeTSKnown = true;
  });

  // Mongoose reports "the conditional update matched nothing" as DocumentNotFoundError
  schema.post('save', function (err, doc, next) {
    if (err && err.name === 'DocumentNotFoundError') {
      return next(new WriteConflictError(
        'Someone else changed this record at the same moment. Please try again.',
        { retryable: true }
      ));
    }
    next(err);
  });

  // Direct updates (atomic operators) must also advance W-TS
  schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function () {
    let update = this.getUpdate();
    if (!update) return;
    if (Array.isArray(update)) { // aggregation-pipeline update
      update.push({ $set: { writeTS: nextTimestamp() } });
      return;
    }
    if (this.op === 'replaceOne') {
      if (!update.writeTS) update.writeTS = nextTimestamp();
      return;
    }
    // normalise { status: 'x', $inc: {...} } into { $set: { status: 'x' }, $inc: {...} }
    const plain = Object.keys(update).filter((k) => !k.startsWith('$'));
    if (plain.length) {
      const $set = { ...(update.$set || {}) };
      plain.forEach((k) => { $set[k] = update[k]; });
      const rest = {};
      Object.keys(update).filter((k) => k.startsWith('$')).forEach((k) => { rest[k] = update[k]; });
      update = { ...rest, $set };
    }
    const { $setOnInsert, ...changes } = update;
    if (touchedFields(update).has('writeTS')) return; // caller manages W-TS explicitly
    const changed = touchedFields(changes);
    if (!changed.size) {
      // pure "insert if missing" upsert: only a newly inserted record gets a W-TS
      update.$setOnInsert = { ...($setOnInsert || {}), writeTS: nextTimestamp() };
    } else if (![...changed].every((f) => ignore.has(f))) {
      update.$set = { ...(update.$set || {}), writeTS: nextTimestamp() };
    }
    this.setUpdate(update);
  });

  // insertMany skips save middleware, so give those records a W-TS too
  schema.pre('insertMany', function (next, docs) {
    (Array.isArray(docs) ? docs : [docs]).forEach((d) => { if (d && !d.writeTS) d.writeTS = nextTimestamp(); });
    next();
  });
}

/* ------------------------------------------------------------------ */
/* 4. Client versions (If-Match / expectedWriteTS)                     */
/* ------------------------------------------------------------------ */
/** The W-TS the browser says it displayed, or null if it sent none. */
function clientVersion(req) {
  let raw = req.get ? req.get('If-Match') : null;
  if (raw) raw = String(raw).replace(/^W\//, '').replace(/"/g, '').trim();
  if (!raw && req.body && req.body.expectedWriteTS) raw = String(req.body.expectedWriteTS);
  if (!raw || raw === '*') return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 'invalid' : t;
}

const manilaTime = (d) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' });

/**
 * Refuses the request if the record changed after the person loaded it.
 * Call right after reading the record and before changing it.
 */
function assertFresh(req, doc, label = 'record') {
  const expected = clientVersion(req);
  if (expected === null || !doc) return;
  const current = doc.writeTS ? new Date(doc.writeTS).getTime() : null;
  if (expected !== 'invalid' && current === expected) return;
  const when = doc.writeTS ? ` at ${manilaTime(doc.writeTS)}` : '';
  throw new WriteConflictError(
    `This ${label} was changed by someone else${when}, after you opened it. Reload to see the latest version, then try again.`,
    { retryable: false, currentWriteTS: doc.writeTS || null }
  );
}

/** Extra filter for findOneAndUpdate/findOneAndDelete so they validate the client version atomically. */
function versionFilter(req) {
  const expected = clientVersion(req);
  if (expected === null) return {};
  if (expected === 'invalid') return { writeTS: { $in: [] } }; // matches nothing -> reported as a conflict
  return { writeTS: new Date(expected) };
}

/**
 * After a conditional findOneAnd* returned nothing: was it missing, or a version conflict?
 * Throws WriteConflictError for a conflict, returns false when the record really doesn't exist.
 */
async function explainMiss(req, Model, id, label = 'record') {
  const doc = await Model.findById(id).select('writeTS');
  if (!doc) return false;
  assertFresh(req, doc, label);
  throw new WriteConflictError(`Someone else changed this ${label} at the same moment. Please try again.`);
}

/* ------------------------------------------------------------------ */
/* 5. Transactions: TS(T), abort and restart                            */
/* ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wraps an Express handler as a transaction. Each attempt gets a new TS(T) in res.locals.tx.
 * A retryable WriteConflictError restarts the handler (after a short random back-off so the
 * competing transactions don't collide again); anything else is answered normally.
 */
function tx(handler) {
  return async function txHandler(req, res, next) {
    for (let attempt = 1; ; attempt++) {
      res.locals.tx = { ts: nextTimestamp(), attempt, canRetry: attempt < MAX_ATTEMPTS };
      try {
        await handler(req, res, next);
        return;
      } catch (err) {
        if (isConflict(err) && err.retryable && attempt < MAX_ATTEMPTS && !res.headersSent) {
          await sleep(5 + Math.floor(Math.random() * 20 * attempt));
          continue;
        }
        if (res.headersSent) { console.error(err); return; }
        require('./handleError')(res, err, { final: true });
        return;
      }
    }
  };
}

/** Wraps the final handler of every POST/PUT/PATCH/DELETE route registered on this router. */
function txRouter(router) {
  ['post', 'put', 'patch', 'delete'].forEach((method) => {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => {
      const last = handlers.length - 1;
      if (last >= 0 && typeof handlers[last] === 'function') handlers[last] = tx(handlers[last]);
      return original(path, ...handlers);
    };
  });
  return router;
}

module.exports = {
  MAX_ATTEMPTS,
  nextTimestamp,
  WriteConflictError,
  isConflict,
  timestampConcurrency,
  clientVersion,
  assertFresh,
  versionFilter,
  explainMiss,
  tx,
  txRouter,
  _touchedFields: touchedFields,
};
