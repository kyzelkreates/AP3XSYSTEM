// AP3X Sync Engine — RUN 10
// Constants, type definitions, conflict strategies, and retry config.
// Single source of truth for all sync logic.

// ─── SYNC DIRECTIONS ──────────────────────────────────────────────────────────
export const SYNC_DIRECTION = {
  PUSH:  "push",    // device → server
  PULL:  "pull",    // server → device
  MERGE: "merge"    // bidirectional reconciliation
};

// ─── SYNC STATUS ──────────────────────────────────────────────────────────────
export const SYNC_STATUS = {
  PENDING:    "pending",     // queued, not yet attempted
  IN_FLIGHT:  "in_flight",   // currently being sent
  COMPLETE:   "complete",    // acknowledged by server
  FAILED:     "failed",      // all retries exhausted
  CONFLICT:   "conflict",    // server has newer version — needs reconciliation
  DROPPED:    "dropped"      // intentionally discarded (superseded or invalid)
};

// ─── OPERATION TYPES ──────────────────────────────────────────────────────────
// Each sync item carries one operation type — used by reconciler to route it.
export const SYNC_OP = {
  // Tachograph
  TACHO_ACTIVITY:      "tacho.activity",
  TACHO_SESSION_START: "tacho.session.start",
  TACHO_SESSION_END:   "tacho.session.end",

  // Hazards
  HAZARD_REPORT:       "hazard.report",
  HAZARD_CONFIRM:      "hazard.confirm",
  HAZARD_DISPUTE:      "hazard.dispute",
  HAZARD_RESOLVE:      "hazard.resolve",

  // Navigation
  NAV_DROP_REACHED:    "nav.drop.reached",
  NAV_DROP_SKIPPED:    "nav.drop.skipped",
  NAV_POSITION_UPDATE: "nav.position.update",
  NAV_ROUTE_COMPLETE:  "nav.route.complete",

  // Device
  DEVICE_HEARTBEAT:    "device.heartbeat",
  DEVICE_CHECKIN:      "device.checkin",

  // Generic
  ENTITY_UPSERT:       "entity.upsert",
  ENTITY_DELETE:       "entity.delete",
  EVENT_REPLAY:        "event.replay"
};

// ─── ENTITY TYPES ─────────────────────────────────────────────────────────────
// Entities that can be synced — used for conflict detection key scoping
export const SYNC_ENTITY = {
  ROUTE:    "route",
  HAZARD:   "hazard",
  TACHO:    "tacho",
  DRIVER:   "driver",
  DEVICE:   "device",
  NAV:      "nav"
};

// ─── CONFLICT RESOLUTION STRATEGIES ──────────────────────────────────────────
export const CONFLICT_STRATEGY = {
  SERVER_WINS:   "server_wins",   // discard local, apply server state
  CLIENT_WINS:   "client_wins",   // apply local, overwrite server
  MERGE_FIELDS:  "merge_fields",  // field-level merge (non-destructive)
  LAST_WRITE:    "last_write",    // compare timestamps — newest wins
  MANUAL:        "manual"         // escalate to fleet admin (future)
};

// ─── PER-ENTITY CONFLICT STRATEGY MAP ────────────────────────────────────────
// Default conflict resolution per entity type
export const ENTITY_CONFLICT_STRATEGY = {
  route:  CONFLICT_STRATEGY.SERVER_WINS,    // route always authoritative from server
  hazard: CONFLICT_STRATEGY.MERGE_FIELDS,   // merge — both sides may have updates
  tacho:  CONFLICT_STRATEGY.MERGE_FIELDS,   // accumulator merge (add, never subtract)
  driver: CONFLICT_STRATEGY.SERVER_WINS,    // identity/status always from server
  device: CONFLICT_STRATEGY.CLIENT_WINS,    // device state is owned by device
  nav:    CONFLICT_STRATEGY.LAST_WRITE      // last GPS/drop update wins
};

// ─── RETRY CONFIG ─────────────────────────────────────────────────────────────
export const RETRY = {
  MAX_ATTEMPTS:      5,
  BASE_DELAY_MS:     500,          // 500ms initial
  MAX_DELAY_MS:      30_000,       // 30s cap
  BACKOFF_FACTOR:    2,            // exponential: 500 → 1000 → 2000 → 4000 → 8000
  JITTER_FACTOR:     0.2,          // ±20% jitter
  TIMEOUT_MS:        12_000,       // per-request timeout
  QUEUE_CONCURRENCY: 4             // max parallel in-flight items
};

// ─── MERGE RULES ──────────────────────────────────────────────────────────────
// For MERGE_FIELDS strategy — defines which fields from each side win
export const MERGE_RULES = {
  tacho: {
    // Accumulator fields: always take the higher value (prevents time going backwards)
    additive: ["continuousDriveMin", "todayDriveMin", "weekDriveMin", "fortDriveMin",
               "breakMin", "shiftMin", "todayRestMin"],
    // Status fields: server wins
    server_wins: ["status", "violations", "regulation"],
    // Timestamp: newer wins
    timestamp: ["startTime", "lastUpdateTime", "endTime"]
  },
  hazard: {
    additive:    ["confirmations", "rejections"],
    server_wins: ["status", "severity", "expiresAt"],
    client_wins: ["description", "lat", "lon", "radiusM", "tags"]
  },
  nav: {
    timestamp:   ["lastPosition", "currentDropIndex", "elapsedMin"],
    server_wins: ["drops", "legs", "summary"],
    client_wins: []
  }
};

// ─── PRIORITY BANDS ───────────────────────────────────────────────────────────
// Higher priority items drain first from the queue
export const PRIORITY = {
  CRITICAL: 0,   // tacho violations, safety blocks
  HIGH:     1,   // hazard reports, drop completions
  NORMAL:   2,   // position updates, heartbeats
  LOW:      3    // telemetry, non-urgent metadata
};

// ─── OP → PRIORITY MAP ────────────────────────────────────────────────────────
export const OP_PRIORITY = {
  [SYNC_OP.TACHO_SESSION_START]: PRIORITY.HIGH,
  [SYNC_OP.TACHO_SESSION_END]:   PRIORITY.HIGH,
  [SYNC_OP.TACHO_ACTIVITY]:      PRIORITY.HIGH,
  [SYNC_OP.HAZARD_REPORT]:       PRIORITY.HIGH,
  [SYNC_OP.HAZARD_CONFIRM]:      PRIORITY.NORMAL,
  [SYNC_OP.HAZARD_DISPUTE]:      PRIORITY.NORMAL,
  [SYNC_OP.HAZARD_RESOLVE]:      PRIORITY.NORMAL,
  [SYNC_OP.NAV_DROP_REACHED]:    PRIORITY.HIGH,
  [SYNC_OP.NAV_DROP_SKIPPED]:    PRIORITY.HIGH,
  [SYNC_OP.NAV_ROUTE_COMPLETE]:  PRIORITY.HIGH,
  [SYNC_OP.NAV_POSITION_UPDATE]: PRIORITY.LOW,
  [SYNC_OP.DEVICE_HEARTBEAT]:    PRIORITY.LOW,
  [SYNC_OP.DEVICE_CHECKIN]:      PRIORITY.NORMAL,
  [SYNC_OP.ENTITY_UPSERT]:       PRIORITY.NORMAL,
  [SYNC_OP.ENTITY_DELETE]:       PRIORITY.NORMAL,
  [SYNC_OP.EVENT_REPLAY]:        PRIORITY.LOW
};

// ─── SUPERSCESSION RULES ─────────────────────────────────────────────────────
// If a newer op of the same type arrives for the same entity,
// drop the older pending item to prevent redundant sync.
export const SUPERSEDABLE_OPS = new Set([
  SYNC_OP.NAV_POSITION_UPDATE,
  SYNC_OP.DEVICE_HEARTBEAT
]);

// ─── CLOCK SKEW ───────────────────────────────────────────────────────────────
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;  // 5 minutes — beyond this, flag for reconciliation
