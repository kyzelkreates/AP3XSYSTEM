// AP3X Tile Manager — RUN 7 (CORE ENGINE)
// Orchestrates tile requests, corridor prefetch, versioning, and LRU eviction.
// Offline-first: IndexedDB → network fallback.
// NO map rendering. NO routing changes. Storage + retrieval only.

import {
  CACHE, ZOOM, CORRIDOR, TILE_STATUS, JOB_STATUS,
  TILE_PROVIDER, TILE_URL_TEMPLATES, tileKey, tileTTL, VERSION
} from "./tile-constants.js";
import {
  getTile, putTile, deleteTile, getTileRange,
  getStaleTiles, getLRUTiles, getCacheStats,
  setMeta, getMeta, putJob, getJob, listJobs, purgeAllTiles
} from "./tile-store.js";

// ─── TILE REQUEST (offline-first) ────────────────────────────────────────────

/**
 * Request a single tile. Checks IndexedDB first, fetches from network if miss or stale.
 *
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {object} options - { provider?, forceRefresh?, apiKey? }
 * @returns {Promise<TileResult>} { source: 'cache'|'network', blob, meta }
 */
export async function requestTile(z, x, y, options = {}) {
  const provider = options.provider || TILE_PROVIDER.OSM;
  _assertZoom(z);

  // ── 1. Check IndexedDB ───────────────────────────────────────────────────
  if (!options.forceRefresh) {
    const cached = await getTile(provider, z, x, y);
    if (cached && cached.status === TILE_STATUS.CACHED && cached.expiresAt > Date.now()) {
      return { source: "cache", blob: cached.blob, meta: _stripBlob(cached) };
    }
  }

  // ── 2. Fetch from network ────────────────────────────────────────────────
  const blob = await _fetchTile(provider, z, x, y, options.apiKey);
  const record = await putTile(
    { provider, z, x, y, version: _dateVersion(), format: "image/png" },
    blob
  );

  return { source: "network", blob, meta: _stripBlob(record) };
}

// ─── CORRIDOR PREFETCH ────────────────────────────────────────────────────────

/**
 * Prefetch all tiles along a route corridor with +2 tile buffer.
 * Samples legs at CORRIDOR.LEG_SAMPLE_M intervals, converts to tile coords,
 * expands by CORRIDOR.BUFFER in all 8 directions, deduplicates, then fetches.
 *
 * @param {object[]} legs    - Route leg objects [{ from, to }] from route-builder
 * @param {object}   options - { provider?, zoomMin?, zoomMax?, apiKey?, fleetId?, routeId? }
 * @returns {Promise<PrefetchJob>}
 */
export async function prefetchRouteCorridor(legs, options = {}) {
  const provider = options.provider || TILE_PROVIDER.OSM;
  const zMin     = Math.max(options.zoomMin ?? ZOOM.ROUTE_MIN, ZOOM.ROUTE_MIN);
  const zMax     = Math.min(options.zoomMax ?? ZOOM.ROUTE_MAX, ZOOM.MAX);

  // ── 1. Build tile set across all zoom levels ─────────────────────────────
  const tileSet = new Set();

  for (let z = zMin; z <= zMax; z++) {
    for (const leg of legs) {
      const points = _sampleLeg(leg.from, leg.to, CORRIDOR.LEG_SAMPLE_M);
      for (const pt of points) {
        const [tx, ty] = latLonToTile(pt.lat, pt.lon, z);
        // Apply +2 buffer in all 8 directions
        for (let dx = -CORRIDOR.BUFFER; dx <= CORRIDOR.BUFFER; dx++) {
          for (let dy = -CORRIDOR.BUFFER; dy <= CORRIDOR.BUFFER; dy++) {
            const bx = tx + dx;
            const by = ty + dy;
            if (_tileInBounds(bx, by, z)) {
              tileSet.add(tileKey(provider, z, bx, by));
            }
          }
        }
      }
    }
  }

  // ── 2. Enforce cap ───────────────────────────────────────────────────────
  let tileList = [...tileSet];
  const capped = tileList.length > CORRIDOR.MAX_TILES_ROUTE;
  if (capped) tileList = tileList.slice(0, CORRIDOR.MAX_TILES_ROUTE);

  // ── 3. Filter already-valid cached tiles ─────────────────────────────────
  const toFetch = [];
  for (const key of tileList) {
    const [prov, zs, xs, ys] = key.split("/");
    const cached = await getTile(prov, +zs, +xs, +ys);
    if (!cached || cached.status !== TILE_STATUS.CACHED || cached.expiresAt <= Date.now()) {
      toFetch.push({ z: +zs, x: +xs, y: +ys });
    }
  }

  // ── 4. Create job record ─────────────────────────────────────────────────
  const jobId = crypto.randomUUID();
  const job   = {
    id:          jobId,
    fleetId:     options.fleetId  || null,
    routeId:     options.routeId  || null,
    provider,
    zMin, zMax,
    totalTiles:  tileList.length,
    toFetch:     toFetch.length,
    fetched:     0,
    failed:      0,
    capped,
    status:      JOB_STATUS.RUNNING,
    createdAt:   Date.now(),
    completedAt: null,
    errors:      []
  };
  await putJob(job);

  // ── 5. Fetch in batches (FETCH_CONCURRENCY parallel) ──────────────────────
  for (let i = 0; i < toFetch.length; i += CACHE.FETCH_CONCURRENCY) {
    const batch = toFetch.slice(i, i + CACHE.FETCH_CONCURRENCY);
    await Promise.allSettled(
      batch.map(async ({ z, x, y }) => {
        try {
          const blob = await _fetchTile(provider, z, x, y, options.apiKey);
          await putTile({ provider, z, x, y, version: _dateVersion(), format: "image/png" }, blob);
          job.fetched++;
        } catch (err) {
          job.failed++;
          if (job.errors.length < 20) job.errors.push(`${z}/${x}/${y}: ${err.message}`);
        }
        // Persist progress every 10 tiles
        if ((job.fetched + job.failed) % 10 === 0) await putJob(job);
      })
    );
  }

  // ── 6. Finalise job ───────────────────────────────────────────────────────
  job.status      = job.failed > 0 && job.fetched === 0 ? JOB_STATUS.FAILED : JOB_STATUS.COMPLETE;
  job.completedAt = Date.now();
  await putJob(job);

  return job;
}

// ─── TILE VERSIONING ──────────────────────────────────────────────────────────

/**
 * Get or initialise the tile version manifest.
 * Version = ISO date string of last full cache refresh.
 */
export async function getTileVersion(provider) {
  const key = `${VERSION.MANIFEST_KEY}:${provider}`;
  return await getMeta(key);
}

/**
 * Stamp a new version into the manifest for a provider.
 * Called after a successful prefetch job.
 */
export async function stampTileVersion(provider) {
  const key     = `${VERSION.MANIFEST_KEY}:${provider}`;
  const version = _dateVersion();
  await setMeta(key, { version, stampedAt: Date.now() });
  return version;
}

/**
 * Check if cached tiles for a provider are outdated vs. a required version.
 */
export async function isTileVersionCurrent(provider, requiredVersion) {
  const manifest = await getTileVersion(provider);
  if (!manifest) return false;
  return manifest.version >= requiredVersion;
}

// ─── EVICTION ────────────────────────────────────────────────────────────────

/**
 * Evict stale tiles (TTL expired).
 * Returns count of evicted tiles.
 */
export async function evictStaleTiles() {
  const stale   = await getStaleTiles(500);
  let evicted   = 0;

  for (const t of stale) {
    await deleteTile(t.provider, t.z, t.x, t.y);
    evicted++;
  }
  return evicted;
}

/**
 * Evict LRU tiles when cache exceeds MAX_CACHE_BYTES * EVICT_TARGET_PCT.
 * Returns count of evicted tiles.
 */
export async function evictLRU() {
  const stats = await getCacheStats();
  if (stats.totalBytes < CACHE.MAX_CACHE_BYTES * CACHE.EVICT_TARGET_PCT) return 0;

  const lru     = await getLRUTiles(200);
  let evicted   = 0;
  let freed     = 0;
  const target  = stats.totalBytes - (CACHE.MAX_CACHE_BYTES * CACHE.EVICT_TARGET_PCT);

  for (const t of lru) {
    if (freed >= target) break;
    await deleteTile(t.provider, t.z, t.x, t.y);
    freed   += t.sizeBytes || 0;
    evicted++;
  }
  return evicted;
}

/**
 * Full cache maintenance: evict stale, then LRU if still over limit.
 * Call on a schedule or before a large prefetch job.
 */
export async function runCacheMaintenance() {
  const staleEvicted = await evictStaleTiles();
  const lruEvicted   = await evictLRU();
  const stats        = await getCacheStats();
  return { staleEvicted, lruEvicted, stats };
}

// ─── STATS + JOBS ─────────────────────────────────────────────────────────────

export async function getCacheSummary() {
  return await getCacheStats();
}

export async function getPrefetchJob(jobId) {
  return await getJob(jobId);
}

export async function getPrefetchJobs(fleetId) {
  return await listJobs(fleetId);
}

export async function nukeTileCache() {
  await purgeAllTiles();
  return true;
}

// ─── COORDINATE MATHS ────────────────────────────────────────────────────────

/**
 * Convert lat/lon to tile x/y at zoom z.
 * Standard slippy-map tile addressing (OSM convention).
 */
export function latLonToTile(lat, lon, z) {
  const x = Math.floor((lon + 180) / 360 * Math.pow(2, z));
  const y = Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI)
    / 2 * Math.pow(2, z)
  );
  return [x, y];
}

/**
 * Convert tile x/y/z back to lat/lon (NW corner of tile).
 */
export function tileToLatLon(x, y, z) {
  const n   = Math.pow(2, z);
  const lon = x / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  return { lat, lon };
}

/**
 * Get bounding box for a set of lat/lon points.
 * Used to compute tile ranges before prefetch.
 */
export function getBoundingBox(points) {
  let minLat =  90, maxLat = -90;
  let minLon = 180, maxLon = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
  }
  return { minLat, maxLat, minLon, maxLon };
}

// ─── INTERNAL ────────────────────────────────────────────────────────────────

async function _fetchTile(provider, z, x, y, apiKey) {
  let url = (TILE_URL_TEMPLATES[provider] || TILE_URL_TEMPLATES.osm)
    .replace("{z}", z).replace("{x}", x).replace("{y}", y);

  if (apiKey) url = url.replace("{apiKey}", apiKey);

  let lastErr;
  for (let attempt = 1; attempt <= CACHE.RETRY_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), CACHE.FETCH_TIMEOUT_MS);

      let resp;
      try {
        resp = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);

      const blob = await resp.blob();
      if (blob.size === 0) throw new Error(`Empty tile response for ${z}/${x}/${y}`);
      return blob;

    } catch (err) {
      lastErr = err;
      if (attempt < CACHE.RETRY_ATTEMPTS) {
        await _sleep(CACHE.RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr;
}

function _sampleLeg(from, to, intervalM) {
  const points     = [from];
  const totalM     = _haversineM(from.lat, from.lon, to.lat, to.lon);
  const steps      = Math.max(1, Math.floor(totalM / intervalM));
  const fracStep   = 1 / steps;

  for (let i = 1; i < steps; i++) {
    const frac = i * fracStep;
    points.push({
      lat: from.lat + (to.lat - from.lat) * frac,
      lon: from.lon + (to.lon - from.lon) * frac
    });
  }
  points.push(to);
  return points;
}

function _tileInBounds(x, y, z) {
  const maxTile = Math.pow(2, z);
  return x >= 0 && x < maxTile && y >= 0 && y < maxTile;
}

function _assertZoom(z) {
  if (z < ZOOM.MIN || z > ZOOM.MAX) {
    throw new Error(`Zoom level ${z} out of range (${ZOOM.MIN}–${ZOOM.MAX})`);
  }
}

function _stripBlob(record) {
  const { blob, ...meta } = record;
  return meta;
}

function _dateVersion() {
  return new Date().toISOString().slice(0, 10);
}

function _haversineM(lat1, lon1, lat2, lon2) {
  const R  = 6_371_000;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(dL / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
