// AP3X Sync Queue — RUN 10
// Durable, priority-ordered queue for all outbound sync operations.
// Persists to IndexedDB on device side; in-memory on server side.
// Handles enqueue, dequeue, retry bookkeeping, and superscession.
// NO UI. NO routing. NO fleet logic changes.

import {
  SYNC_STATUS, RETRY, PRIORITY, OP_PRIORITY,
  SUPERSEDABLE_OPS, SYNC_OP
} from "./sync-constants.js";

// ─── QUEUE STORE ──────────────────────────────────────────────────────────────
// In server context: plain Map (in-memory, drained immediately)
// In device/PWA context: backed by IndexedDB (see sync-idb.js adapter)
// This module is storage-agnostic — it delegates persistence to an adapter.

/**
 * @typedef {object} SyncItem
 * @property {string}   id            - UUID
 * @property {string}   op            - SYNC_OP.*
 * @property {string}   entityType    - SYNC_ENTITY.*
 * @property {string}   entityId      - ID of the entity being synced
 * @property {object}   payload       - Operation data
 * @property {string}   status        - SYNC_STATUS.*
 * @property {number}   priority      - Lower = higher priority
 * @property {number}   attempts      - Times attempted
 * @property {number}   maxAttempts   - Retry cap
 * @property {number}   enqueuedAt    - ms timestamp
 * @property {number}   nextRetryAt   - ms timestamp (0 = ready now)
 * @property {string}   deviceId      - originating device
 * @property {string}   driverId      - originating driver (if applicable)
 * @property {string}   fleetId       - fleet context
 * @property {string|null} lastError  - Last failure message
 * @property {string|null} serverAck  - Server's ack token (set on complete)
 * @property {string}   vectorClock   - "{deviceId}:{lamportSeq}" for ordering
 */

// ─── CREATE ITEM ─────────────────────────────────────────────────────────────

/**
 * Build a new sync item. Does NOT enqueue — caller must pass to enqueue().
 */
export function createSyncItem(op, entityType, entityId, payload, context = {}) {
  const priority = OP_PRIORITY[op] ?? PRIORITY.NORMAL;

  return {
    id:           crypto.randomUUID(),
    op,
    entityType,
    entityId,
    payload,
    status:       SYNC_STATUS.PENDING,
    priority,
    attempts:     0,
    maxAttempts:  RETRY.MAX_ATTEMPTS,
    enqueuedAt:   Date.now(),
    nextRetryAt:  0,
    deviceId:     context.deviceId  || null,
    driverId:     context.driverId  || null,
    fleetId:      context.fleetId   || null,
    lastError:    null,
    serverAck:    null,
    vectorClock:  _makeVectorClock(context.deviceId, context.lamportSeq)
  };
}

// ─── QUEUE CLASS ──────────────────────────────────────────────────────────────

export class SyncQueue {
  constructor(adapter) {
    // adapter: { get(id), put(item), delete(id), getAll(), clear() }
    // Defaults to in-memory if no adapter provided
    this._adapter = adapter || new MemoryAdapter();
    this._lamport = 0;
  }

  // ── ENQUEUE ────────────────────────────────────────────────────────────────

  /**
   * Add an item to the queue.
   * Handles superscession: if a newer op of the same supersedable type
   * already targets the same entity, the incoming item replaces the old one.
   */
  async enqueue(item) {
    // Superscession check — discard older pending of same supersedable op
    if (SUPERSEDABLE_OPS.has(item.op)) {
      const existing = await this._findSuperseded(item.op, item.entityId);
      if (existing) {
        await this._adapter.delete(existing.id);
      }
    }

    this._lamport++;
    item.vectorClock = _makeVectorClock(item.deviceId, this._lamport);

    await this._adapter.put(item);
    return item;
  }

  // ── DEQUEUE (ready items in priority order) ───────────────────────────────

  /**
   * Get up to `limit` items that are ready to send.
   * Ready = pending/failed + nextRetryAt <= now.
   * Sorted: priority ASC, enqueuedAt ASC (FIFO within priority band).
   */
  async getReadyItems(limit = RETRY.QUEUE_CONCURRENCY) {
    const all = await this._adapter.getAll();
    const now = Date.now();

    return all
      .filter(i =>
        (i.status === SYNC_STATUS.PENDING || i.status === SYNC_STATUS.FAILED) &&
        i.attempts < i.maxAttempts &&
        i.nextRetryAt <= now
      )
      .sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt)
      .slice(0, limit);
  }

  // ── MARK IN-FLIGHT ────────────────────────────────────────────────────────

  async markInFlight(id) {
    const item = await this._adapter.get(id);
    if (!item) return null;
    item.status    = SYNC_STATUS.IN_FLIGHT;
    item.attempts += 1;
    await this._adapter.put(item);
    return item;
  }

  // ── MARK COMPLETE ─────────────────────────────────────────────────────────

  async markComplete(id, serverAck = null) {
    const item = await this._adapter.get(id);
    if (!item) return null;
    item.status    = SYNC_STATUS.COMPLETE;
    item.serverAck = serverAck;
    await this._adapter.put(item);
    return item;
  }

  // ── MARK FAILED (schedule retry) ─────────────────────────────────────────

  async markFailed(id, errorMessage) {
    const item = await this._adapter.get(id);
    if (!item) return null;

    item.lastError = errorMessage;

    if (item.attempts >= item.maxAttempts) {
      item.status = SYNC_STATUS.FAILED;
    } else {
      item.status      = SYNC_STATUS.PENDING;
      item.nextRetryAt = _calcRetryDelay(item.attempts);
    }

    await this._adapter.put(item);
    return item;
  }

  // ── MARK CONFLICT ─────────────────────────────────────────────────────────

  async markConflict(id, serverState) {
    const item = await this._adapter.get(id);
    if (!item) return null;
    item.status      = SYNC_STATUS.CONFLICT;
    item.serverState = serverState;
    await this._adapter.put(item);
    return item;
  }

  // ── DROP ──────────────────────────────────────────────────────────────────

  async drop(id, reason = "manual") {
    const item = await this._adapter.get(id);
    if (!item) return null;
    item.status     = SYNC_STATUS.DROPPED;
    item.lastError  = `dropped: ${reason}`;
    await this._adapter.put(item);
    return item;
  }

  // ── PURGE COMPLETED ───────────────────────────────────────────────────────

  async purgeCompleted(olderThanMs = 24 * 60 * 60 * 1000) {
    const all    = await this._adapter.getAll();
    const cutoff = Date.now() - olderThanMs;
    let   purged = 0;
    for (const item of all) {
      if (
        (item.status === SYNC_STATUS.COMPLETE || item.status === SYNC_STATUS.DROPPED) &&
        item.enqueuedAt < cutoff
      ) {
        await this._adapter.delete(item.id);
        purged++;
      }
    }
    return purged;
  }

  // ── STATS ─────────────────────────────────────────────────────────────────

  async getStats() {
    const all = await this._adapter.getAll();
    const stats = {
      total:    all.length,
      pending:  0, in_flight: 0, complete: 0,
      failed:   0, conflict:  0, dropped:  0
    };
    for (const item of all) stats[item.status] = (stats[item.status] || 0) + 1;
    return stats;
  }

  async getAll()         { return this._adapter.getAll(); }
  async get(id)          { return this._adapter.get(id); }

  // ── INTERNAL ──────────────────────────────────────────────────────────────

  async _findSuperseded(op, entityId) {
    const all = await this._adapter.getAll();
    return all.find(i =>
      i.op       === op &&
      i.entityId === entityId &&
      i.status   === SYNC_STATUS.PENDING
    ) || null;
  }
}

// ─── IN-MEMORY ADAPTER ────────────────────────────────────────────────────────
// Used server-side or in tests. Swap for IndexedDB adapter in PWA context.

export class MemoryAdapter {
  constructor() { this._store = new Map(); }
  async get(id)     { return this._store.get(id) || null; }
  async put(item)   { this._store.set(item.id, { ...item }); return item; }
  async delete(id)  { this._store.delete(id); }
  async getAll()    { return [...this._store.values()]; }
  async clear()     { this._store.clear(); }
}

// ─── INDEXEDDB ADAPTER ────────────────────────────────────────────────────────
// Drop-in replacement for browser (PWA) context.

export class IndexedDBAdapter {
  constructor(dbName = "ap3x_sync_v2", storeName = "queue") {
    this._dbName    = dbName;
    this._storeName = storeName;
    this._db        = null;
  }

  async _open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName, 1);
      req.onupgradeneeded = (e) => {
        const db    = e.target.result;
        const store = db.createObjectStore(this._storeName, { keyPath: "id" });
        store.createIndex("by_status",   "status",      { unique: false });
        store.createIndex("by_priority", "priority",    { unique: false });
        store.createIndex("by_entity",   "entityId",    { unique: false });
        store.createIndex("by_op",       "op",          { unique: false });
        store.createIndex("by_retry",    "nextRetryAt", { unique: false });
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async get(id) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this._storeName, "readonly").objectStore(this._storeName).get(id);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async put(item) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this._storeName, "readwrite");
      tx.objectStore(this._storeName).put(item).onsuccess = () => resolve(item);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async delete(id) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, "readwrite");
      tx.objectStore(this._storeName).delete(id).onsuccess = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async getAll() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this._storeName, "readonly").objectStore(this._storeName).getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async clear() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, "readwrite");
      tx.objectStore(this._storeName).clear().onsuccess = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _calcRetryDelay(attempts) {
  const base    = RETRY.BASE_DELAY_MS * Math.pow(RETRY.BACKOFF_FACTOR, attempts);
  const capped  = Math.min(base, RETRY.MAX_DELAY_MS);
  const jitter  = capped * RETRY.JITTER_FACTOR * (Math.random() * 2 - 1);
  return Date.now() + Math.round(capped + jitter);
}

function _makeVectorClock(deviceId, seq) {
  return `${deviceId || "unknown"}:${seq || 0}`;
}
