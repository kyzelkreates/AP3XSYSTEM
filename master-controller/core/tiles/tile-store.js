// AP3X Tile Store — RUN 7
// IndexedDB abstraction layer for tile data persistence.
// Offline-first. All reads check IndexedDB first, network second.
// Runs in browser context (PWA) — no Node.js fs fallback needed.
// NO map rendering. NO routing changes. Storage + retrieval only.

import { CACHE, TILE_STATUS, tileKey, tileTTL } from "./tile-constants.js";

// ─── DB SINGLETON ─────────────────────────────────────────────────────────────
let _db = null;

/**
 * Open (or return cached) IndexedDB connection.
 * Creates object stores on first run.
 */
export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE.DB_NAME, CACHE.DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      // ── tiles store ───────────────────────────────────────────────────────
      // Primary key: tileKey (provider/z/x/y)
      if (!db.objectStoreNames.contains(CACHE.STORE_TILES)) {
        const tileStore = db.createObjectStore(CACHE.STORE_TILES, { keyPath: "key" });
        tileStore.createIndex("by_status",    "status",     { unique: false });
        tileStore.createIndex("by_expires",   "expiresAt",  { unique: false });
        tileStore.createIndex("by_accessed",  "lastAccessed",{ unique: false });
        tileStore.createIndex("by_provider",  "provider",   { unique: false });
        tileStore.createIndex("by_zoom",      "z",          { unique: false });
      }

      // ── tile_meta store ───────────────────────────────────────────────────
      // Metadata without blob data — used for manifest, stats, version checks
      if (!db.objectStoreNames.contains(CACHE.STORE_META)) {
        db.createObjectStore(CACHE.STORE_META, { keyPath: "key" });
      }

      // ── tile_jobs store ───────────────────────────────────────────────────
      // Cache prefetch job tracking
      if (!db.objectStoreNames.contains(CACHE.STORE_JOBS)) {
        const jobStore = db.createObjectStore(CACHE.STORE_JOBS, { keyPath: "id" });
        jobStore.createIndex("by_status", "status", { unique: false });
        jobStore.createIndex("by_fleet",  "fleetId",{ unique: false });
        jobStore.createIndex("by_route",  "routeId",{ unique: false });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = (e) => reject(new Error(`IndexedDB open failed: ${e.target.error}`));
  });
}

// ─── TILE READ ────────────────────────────────────────────────────────────────

/**
 * Get a tile from IndexedDB.
 * Updates lastAccessed on hit. Returns null on miss.
 * @returns {TileRecord|null}
 */
export async function getTile(provider, z, x, y) {
  const db  = await openDB();
  const key = tileKey(provider, z, x, y);

  return new Promise((resolve, reject) => {
    const tx  = db.transaction(CACHE.STORE_TILES, "readwrite");
    const req = tx.objectStore(CACHE.STORE_TILES).get(key);

    req.onsuccess = (e) => {
      const record = e.target.result;
      if (!record) return resolve(null);

      // Mark accessed (for LRU eviction)
      record.lastAccessed = Date.now();
      tx.objectStore(CACHE.STORE_TILES).put(record);

      // Check TTL
      if (record.expiresAt < Date.now()) {
        record.status = TILE_STATUS.STALE;
      }

      resolve(record);
    };
    req.onerror = (e) => reject(new Error(`getTile failed: ${e.target.error}`));
  });
}

// ─── TILE WRITE ───────────────────────────────────────────────────────────────

/**
 * Store a tile blob in IndexedDB.
 * Enforces MAX_SINGLE_TILE_B size limit.
 * @param {object} meta  - { provider, z, x, y, version, format }
 * @param {Blob}   blob  - raw tile data
 * @returns {TileRecord}
 */
export async function putTile(meta, blob) {
  if (blob.size > CACHE.MAX_SINGLE_TILE_B) {
    throw new Error(`Tile ${tileKey(meta.provider, meta.z, meta.x, meta.y)} exceeds size limit (${blob.size}B > ${CACHE.MAX_SINGLE_TILE_B}B)`);
  }

  const db  = await openDB();
  const key = tileKey(meta.provider, meta.z, meta.x, meta.y);
  const now = Date.now();

  const record = {
    key,
    provider:     meta.provider,
    z:            meta.z,
    x:            meta.x,
    y:            meta.y,
    blob,
    format:       meta.format  || "image/png",
    version:      meta.version || _dateVersion(),
    sizeBytes:    blob.size,
    status:       TILE_STATUS.CACHED,
    fetchedAt:    now,
    expiresAt:    now + tileTTL(meta.z),
    lastAccessed: now
  };

  return new Promise((resolve, reject) => {
    const tx  = db.transaction(CACHE.STORE_TILES, "readwrite");
    const req = tx.objectStore(CACHE.STORE_TILES).put(record);
    req.onsuccess = () => resolve(record);
    req.onerror   = (e) => reject(new Error(`putTile failed: ${e.target.error}`));
  });
}

// ─── TILE DELETE ──────────────────────────────────────────────────────────────

export async function deleteTile(provider, z, x, y) {
  const db  = await openDB();
  const key = tileKey(provider, z, x, y);
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(CACHE.STORE_TILES, "readwrite");
    const req = tx.objectStore(CACHE.STORE_TILES).delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror   = (e) => reject(new Error(`deleteTile failed: ${e.target.error}`));
  });
}

// ─── BULK READS ───────────────────────────────────────────────────────────────

/**
 * Get all tile records for a given zoom + bounding tile range.
 * Used by prefetch engine to detect what's already cached.
 */
export async function getTileRange(provider, z, xMin, xMax, yMin, yMax) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const results = [];
    const tx      = db.transaction(CACHE.STORE_TILES, "readonly");
    const idx     = tx.objectStore(CACHE.STORE_TILES).index("by_zoom");
    const req     = idx.openCursor(IDBKeyRange.only(z));

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(results);
      const r = cursor.value;
      if (
        r.provider === provider &&
        r.x >= xMin && r.x <= xMax &&
        r.y >= yMin && r.y <= yMax
      ) {
        results.push(r);
      }
      cursor.continue();
    };
    req.onerror = (e) => reject(new Error(`getTileRange failed: ${e.target.error}`));
  });
}

/**
 * Get all stale tiles (TTL elapsed) across the whole cache.
 */
export async function getStaleTiles(limit = 500) {
  const db  = await openDB();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const results = [];
    const tx      = db.transaction(CACHE.STORE_TILES, "readonly");
    const idx     = tx.objectStore(CACHE.STORE_TILES).index("by_expires");
    const req     = idx.openCursor(IDBKeyRange.upperBound(now));

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor || results.length >= limit) return resolve(results);
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = (e) => reject(new Error(`getStaleTiles failed: ${e.target.error}`));
  });
}

/**
 * Get LRU tiles for eviction (least recently accessed).
 */
export async function getLRUTiles(limit = 200) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const results = [];
    const tx      = db.transaction(CACHE.STORE_TILES, "readonly");
    const idx     = tx.objectStore(CACHE.STORE_TILES).index("by_accessed");
    const req     = idx.openCursor(); // ascending = oldest first

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor || results.length >= limit) return resolve(results);
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = (e) => reject(new Error(`getLRUTiles failed: ${e.target.error}`));
  });
}

// ─── CACHE STATS ─────────────────────────────────────────────────────────────

/**
 * Return cache statistics — total tile count, estimated size, staleness.
 */
export async function getCacheStats() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let totalTiles  = 0;
    let totalBytes  = 0;
    let staleCount  = 0;
    let failedCount = 0;
    const now = Date.now();

    const tx  = db.transaction(CACHE.STORE_TILES, "readonly");
    const req = tx.objectStore(CACHE.STORE_TILES).openCursor();

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve({
        totalTiles, totalBytes, staleCount, failedCount,
        totalMB: parseFloat((totalBytes / 1024 / 1024).toFixed(2)),
        utilizationPct: parseFloat(((totalBytes / CACHE.MAX_CACHE_BYTES) * 100).toFixed(1))
      });

      const r = cursor.value;
      totalTiles++;
      totalBytes += r.sizeBytes || 0;
      if (r.expiresAt < now)           staleCount++;
      if (r.status === TILE_STATUS.FAILED) failedCount++;
      cursor.continue();
    };
    req.onerror = (e) => reject(new Error(`getCacheStats failed: ${e.target.error}`));
  });
}

// ─── META STORE ───────────────────────────────────────────────────────────────

export async function setMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(CACHE.STORE_META, "readwrite");
    const req = tx.objectStore(CACHE.STORE_META).put({ key, value, updatedAt: Date.now() });
    req.onsuccess = () => resolve(true);
    req.onerror   = (e) => reject(new Error(`setMeta failed: ${e.target.error}`));
  });
}

export async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(CACHE.STORE_META, "readonly").objectStore(CACHE.STORE_META).get(key);
    req.onsuccess = (e) => resolve(e.target.result?.value ?? null);
    req.onerror   = (e) => reject(new Error(`getMeta failed: ${e.target.error}`));
  });
}

// ─── JOB STORE ────────────────────────────────────────────────────────────────

export async function putJob(job) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(CACHE.STORE_JOBS, "readwrite");
    const req = tx.objectStore(CACHE.STORE_JOBS).put(job);
    req.onsuccess = () => resolve(job);
    req.onerror   = (e) => reject(new Error(`putJob failed: ${e.target.error}`));
  });
}

export async function getJob(jobId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(CACHE.STORE_JOBS, "readonly").objectStore(CACHE.STORE_JOBS).get(jobId);
    req.onsuccess = (e) => resolve(e.target.result || null);
    req.onerror   = (e) => reject(new Error(`getJob failed: ${e.target.error}`));
  });
}

export async function listJobs(fleetId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const results = [];
    const tx      = db.transaction(CACHE.STORE_JOBS, "readonly");
    const idx     = tx.objectStore(CACHE.STORE_JOBS).index("by_fleet");
    const req     = idx.openCursor(IDBKeyRange.only(fleetId));
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(results.sort((a, b) => b.createdAt - a.createdAt));
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = (e) => reject(new Error(`listJobs failed: ${e.target.error}`));
  });
}

// ─── PURGE ────────────────────────────────────────────────────────────────────

/**
 * Hard purge — delete all tiles from IndexedDB.
 * Use with caution. Emits no events (pure storage op).
 */
export async function purgeAllTiles() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(CACHE.STORE_TILES, "readwrite");
    const req = tx.objectStore(CACHE.STORE_TILES).clear();
    req.onsuccess = () => resolve(true);
    req.onerror   = (e) => reject(new Error(`purgeAllTiles failed: ${e.target.error}`));
  });
}

// ─── INTERNAL ─────────────────────────────────────────────────────────────────

function _dateVersion() {
  return new Date().toISOString().slice(0, 10); // "2026-05-24"
}
