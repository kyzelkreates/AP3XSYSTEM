// AP3X Tile System — RUN 7
// Shared constants for tile caching, versioning, and corridor buffering.
// Referenced by all tile modules — single source of truth.

// ─── TILE PROVIDERS ───────────────────────────────────────────────────────────
export const TILE_PROVIDER = {
  OSM:        "osm",           // OpenStreetMap — primary (no key)
  MAPTILER:   "maptiler",      // MapTiler — higher quality (key required)
  THUNDERFOREST:"thunderforest",// Thunderforest — specialist overlays (key required)
  CUSTOM:     "custom"         // Self-hosted tile server
};

// ─── TILE URL TEMPLATES ───────────────────────────────────────────────────────
// {z}/{x}/{y} standard slippy-map tile addressing
export const TILE_URL_TEMPLATES = {
  osm:         "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maptiler:    "https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key={apiKey}",
  thunderforest:"https://tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey={apiKey}"
};

// ─── ZOOM LEVELS ──────────────────────────────────────────────────────────────
export const ZOOM = {
  MIN:      0,
  MAX:      19,
  ROUTE_MIN:10,   // minimum zoom for route corridor caching
  ROUTE_MAX:16,   // maximum zoom for route corridor caching
  DEFAULT:  14
};

// ─── CORRIDOR BUFFER ──────────────────────────────────────────────────────────
// +2 tile buffer around each route tile — ensures edge coverage during navigation
export const CORRIDOR = {
  BUFFER:         2,    // tiles in each direction (N/S/E/W + diagonals)
  LEG_SAMPLE_M:   500,  // sample route leg every 500m for tile extraction
  MAX_TILES_ROUTE:2000  // hard cap — prevent runaway cache jobs
};

// ─── TILE FORMATS ─────────────────────────────────────────────────────────────
export const TILE_FORMAT = {
  PNG:  "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  MVT:  "application/vnd.mapbox-vector-tile"  // vector tiles (future)
};

// ─── CACHE CONFIG ─────────────────────────────────────────────────────────────
export const CACHE = {
  DB_NAME:        "ap3x_tile_cache",
  DB_VERSION:     1,
  STORE_TILES:    "tiles",
  STORE_META:     "tile_meta",
  STORE_JOBS:     "tile_jobs",

  // TTL per zoom level — lower zoom = longer TTL (changes less often)
  TTL_MS: {
    0:  30 * 24 * 60 * 60 * 1000,   // z0–z8:  30 days
    9:  14 * 24 * 60 * 60 * 1000,   // z9–z11: 14 days
    12:  7 * 24 * 60 * 60 * 1000,   // z12–z14: 7 days
    15:  3 * 24 * 60 * 60 * 1000,   // z15–z17: 3 days
    18:  1 * 24 * 60 * 60 * 1000    // z18–z19: 1 day
  },

  MAX_CACHE_BYTES:   500 * 1024 * 1024,  // 500MB soft limit
  EVICT_TARGET_PCT:  0.80,               // evict down to 80% when over limit
  MAX_SINGLE_TILE_B: 512 * 1024,         // 512KB — reject tiles over this size

  // Fetch config
  FETCH_TIMEOUT_MS:  8000,
  FETCH_CONCURRENCY: 6,                  // parallel tile fetches
  RETRY_ATTEMPTS:    3,
  RETRY_DELAY_MS:    500
};

// ─── TILE STATUS ──────────────────────────────────────────────────────────────
export const TILE_STATUS = {
  PENDING:   "pending",    // queued for download
  FETCHING:  "fetching",   // in-flight
  CACHED:    "cached",     // stored in IndexedDB
  STALE:     "stale",      // TTL elapsed — will re-fetch on next request
  FAILED:    "failed",     // all retries exhausted
  EVICTED:   "evicted"     // removed from cache (LRU or size pressure)
};

// ─── JOB STATUS ───────────────────────────────────────────────────────────────
export const JOB_STATUS = {
  QUEUED:    "queued",
  RUNNING:   "running",
  COMPLETE:  "complete",
  FAILED:    "failed",
  CANCELLED: "cancelled"
};

// ─── VERSIONING ───────────────────────────────────────────────────────────────
export const VERSION = {
  SCHEME:          "date",          // versioning by fetch date
  MANIFEST_KEY:    "ap3x_tile_manifest",
  CURRENT_VERSION: null             // set at runtime from manifest
};

// ─── KEY FORMAT ───────────────────────────────────────────────────────────────
// Canonical tile key used as IndexedDB primary key
// Format: "{provider}/{z}/{x}/{y}"
export function tileKey(provider, z, x, y) {
  return `${provider}/${z}/${x}/${y}`;
}

// TTL lookup by zoom level
export function tileTTL(z) {
  if (z >= 18) return CACHE.TTL_MS[18];
  if (z >= 15) return CACHE.TTL_MS[15];
  if (z >= 12) return CACHE.TTL_MS[12];
  if (z >= 9)  return CACHE.TTL_MS[9];
  return CACHE.TTL_MS[0];
}
