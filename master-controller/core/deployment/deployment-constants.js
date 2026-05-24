// AP3X Deployment Engine — Constants
// Single source of truth for all deployment system values.
// Referenced by orchestrator, packager, version manager, rollback manager.

// ─── DEPLOYMENT STATUS ────────────────────────────────────────────────────────
export const DEPLOY_STATUS = {
  PENDING:      "pending",       // queued, not yet started
  PACKAGING:    "packaging",     // build-packager running
  VALIDATING:   "validating",    // pre-flight checks
  DEPLOYING:    "deploying",     // adapter pushing to target
  HEALTH_CHECK: "health_check",  // post-deploy health verification
  ACTIVE:       "active",        // live and healthy
  FAILED:       "failed",        // deploy failed — previous version still live
  ROLLED_BACK:  "rolled_back",   // rollback executed, previous pinned version live
  SUPERSEDED:   "superseded"     // replaced by a newer deployment
};

// ─── TARGET ENVIRONMENTS ──────────────────────────────────────────────────────
export const DEPLOY_ENV = {
  VERCEL:     "vercel",          // Vercel serverless + static
  SERVER:     "server",          // Traditional Node.js server / VPS
  EDGE:       "edge",            // Cloudflare Workers / Vercel Edge
  LOCAL:      "local"            // Local dev / dry-run
};

// ─── BUNDLE TARGETS ───────────────────────────────────────────────────────────
export const BUNDLE_TARGET = {
  FULL:         "full",          // All fleet components — drivers, vehicles, devices, config
  CONFIG_ONLY:  "config_only",   // Fleet config + branding only — no entity data
  INCREMENTAL:  "incremental",   // Diff from previous version — changed records only
  PWA_ONLY:     "pwa_only",      // Driver PWA assets only — no server-side changes
  ROLLBACK:     "rollback"       // Reverse diff from a specific prior version
};

// ─── ROLLBACK STRATEGIES ─────────────────────────────────────────────────────
export const ROLLBACK_STRATEGY = {
  IMMEDIATE:    "immediate",     // Hard cut to previous active version instantly
  GRACEFUL:     "graceful",      // Wait for in-flight driver sessions to close, then roll back
  CANARY_ABORT: "canary_abort"   // Abort a canary — stop promotion, restore full prior traffic
};

// ─── BUNDLE SECTIONS ─────────────────────────────────────────────────────────
// What a full deployment bundle contains.
export const BUNDLE_SECTION = {
  MANIFEST:    "manifest",       // Bundle metadata — version, checksum, target, fleet ref
  CONFIG:      "config",         // Fleet config (regulation, rules, settings)
  BRANDING:    "branding",       // Logo, colours, name
  DRIVERS:     "drivers",        // Driver records snapshot
  VEHICLES:    "vehicles",       // Vehicle records snapshot
  DEVICES:     "devices",        // Device records snapshot
  PERMISSIONS: "permissions",    // Role assignments
  IDENTITIES:  "identities",     // Driver ↔ device ↔ vehicle bindings
  ROUTES:      "routes",         // Active + recent route records
  ENV_VARS:    "env_vars"        // Non-secret environment values for target adapter
};

// ─── VALIDATION CHECKS ────────────────────────────────────────────────────────
export const PRE_FLIGHT_CHECK = {
  FLEET_EXISTS:        "fleet_exists",
  FLEET_ACTIVE:        "fleet_active",
  HAS_VEHICLES:        "has_vehicles",
  HAS_DRIVERS:         "has_drivers",
  HAS_DEVICES:         "has_devices",
  IDENTITY_BOUND:      "identity_bound",       // at least one complete binding
  REGULATION_SET:      "regulation_set",
  BRAND_CONFIGURED:    "brand_configured",
  NO_ACTIVE_DEPLOY:    "no_active_deploy",      // prevent concurrent deploys
  VERSION_INCREMENTED: "version_incremented"    // new version > current
};

// ─── HEALTH CHECK CONFIG ──────────────────────────────────────────────────────
export const HEALTH = {
  CHECK_INTERVAL_MS:  5_000,    // poll every 5s
  MAX_ATTEMPTS:       12,       // 12 attempts = 60s window
  REQUIRED_PASS:      2,        // must pass N consecutive checks to go ACTIVE
  METRICS: {
    HEARTBEAT_RATE:   "heartbeat_rate",    // % of devices sending heartbeats
    API_LATENCY_MS:   "api_latency_ms",
    SYNC_LAG_MS:      "sync_lag_ms",
    ERROR_RATE:       "error_rate"
  },
  THRESHOLDS: {
    MIN_HEARTBEAT_RATE:  0.8,   // 80% of devices must be online
    MAX_API_LATENCY_MS:  2000,
    MAX_ERROR_RATE:      0.05   // 5% error rate ceiling
  }
};

// ─── VERSIONING ───────────────────────────────────────────────────────────────
export const VERSION = {
  INITIAL:      "1.0.0",
  MAX_HISTORY:  50               // keep last 50 deployments per fleet
};

// ─── LOCK ─────────────────────────────────────────────────────────────────────
// Prevents concurrent deployments to the same fleet.
export const DEPLOY_LOCK_TTL_MS = 10 * 60 * 1000;  // 10 minute lock TTL
