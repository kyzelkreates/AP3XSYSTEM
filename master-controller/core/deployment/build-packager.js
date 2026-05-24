// AP3X Build Packager
// Snapshots a fleet's full configuration and entity state into a versioned bundle.
// Supports full, incremental (diff), config-only, and PWA-only targets.
// READ-ONLY from the SSOT perspective — writes only to store.bundles.
// Only the Master Controller can invoke this. Fleet OS cannot.

import { BUNDLE_TARGET, BUNDLE_SECTION, DEPLOY_STATUS } from "./deployment-constants.js";
import { emitEvent }    from "../event-emitter.js";
import { getFleetBrand } from "../branding-engine.js";

// ─── BUNDLE STRUCTURE ─────────────────────────────────────────────────────────
// store.bundles[bundleId] = {
//   id, deploymentId, fleetId, target (BUNDLE_TARGET.*),
//   version, createdAt, checksum, sizeEstimateBytes,
//   sections: { manifest, config, branding, drivers, vehicles, devices,
//               permissions, identities, routes, env_vars },
//   diff: { added, modified, removed }  (incremental only)
// }

// ─── PACK FLEET ───────────────────────────────────────────────────────────────

/**
 * Build a complete fleet bundle and store in store.bundles.
 *
 * @param {object} store
 * @param {string} deploymentId
 * @param {string} fleetId
 * @param {object} options
 *   target:   BUNDLE_TARGET.*  (default: FULL)
 *   version:  string           semver
 *   fromId:   string           prior bundleId (incremental only)
 *   envVars:  object           non-secret key/value pairs for adapter
 * @returns {Bundle}
 */
export function packFleet(store, deploymentId, fleetId, options = {}) {
  const target  = options.target  || BUNDLE_TARGET.FULL;
  const version = options.version || "1.0.0";
  const fleet   = store.fleets?.[fleetId];

  if (!fleet) throw new Error(`Fleet not found: ${fleetId}`);

  const bundleId = crypto.randomUUID();
  const now      = Date.now();

  let bundle;

  switch (target) {
    case BUNDLE_TARGET.FULL:
      bundle = _packFull(store, bundleId, deploymentId, fleetId, fleet, version, options, now);
      break;
    case BUNDLE_TARGET.INCREMENTAL:
      bundle = _packIncremental(store, bundleId, deploymentId, fleetId, fleet, version, options, now);
      break;
    case BUNDLE_TARGET.CONFIG_ONLY:
      bundle = _packConfig(store, bundleId, deploymentId, fleetId, fleet, version, options, now);
      break;
    case BUNDLE_TARGET.PWA_ONLY:
      bundle = _packPwa(store, bundleId, deploymentId, fleetId, fleet, version, options, now);
      break;
    case BUNDLE_TARGET.ROLLBACK:
      bundle = _packRollback(store, bundleId, deploymentId, fleetId, fleet, version, options, now);
      break;
    default:
      throw new Error(`Unknown bundle target: ${target}`);
  }

  // Write to SSOT
  if (!store.bundles) store.bundles = {};
  store.bundles[bundleId] = bundle;

  // Link bundle to deployment record
  if (store.deployments?.[deploymentId]) {
    store.deployments[deploymentId].bundleId = bundleId;
  }

  emitEvent(store, {
    type:     "deployment.bundle.created",
    fleetId,
    entityId: bundleId,
    payload:  {
      bundleId, deploymentId, target, version,
      sizeBytes: bundle.sizeEstimateBytes,
      sections:  Object.keys(bundle.sections)
    }
  });

  return bundle;
}

// ─── VALIDATE BUNDLE ──────────────────────────────────────────────────────────

/**
 * Validate a bundle before it's handed to an environment adapter.
 * Returns { valid: bool, errors: string[], warnings: string[] }
 */
export function validateBundle(store, bundleId) {
  const bundle  = store.bundles?.[bundleId];
  const errors  = [];
  const warnings = [];

  if (!bundle) return { valid: false, errors: ["Bundle not found"], warnings: [] };

  const { sections, fleetId, target } = bundle;

  // Manifest must exist and have required fields
  const m = sections[BUNDLE_SECTION.MANIFEST];
  if (!m)                      errors.push("Missing manifest section");
  else {
    if (!m.fleetId)            errors.push("Manifest missing fleetId");
    if (!m.version)            errors.push("Manifest missing version");
    if (!m.checksum)           errors.push("Manifest missing checksum");
    if (!m.bundleId)           errors.push("Manifest missing bundleId");
  }

  // Full and incremental bundles need entity sections
  if (target === BUNDLE_TARGET.FULL || target === BUNDLE_TARGET.INCREMENTAL) {
    if (!sections[BUNDLE_SECTION.CONFIG])      errors.push("Missing config section");
    if (!sections[BUNDLE_SECTION.DRIVERS])     errors.push("Missing drivers section");
    if (!sections[BUNDLE_SECTION.VEHICLES])    errors.push("Missing vehicles section");
  }

  // Warn on empty entity sets
  const fleet = store.fleets?.[fleetId];
  if (fleet) {
    const driverCount  = Object.values(store.drivers  || {}).filter(d => d.fleetId === fleetId).length;
    const vehicleCount = Object.values(store.vehicles || {}).filter(v => v.fleetId === fleetId).length;
    const deviceCount  = Object.values(store.devices  || {}).filter(d => d.fleetId === fleetId).length;
    if (driverCount  === 0) warnings.push("Fleet has no drivers");
    if (vehicleCount === 0) warnings.push("Fleet has no vehicles");
    if (deviceCount  === 0) warnings.push("Fleet has no registered devices");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── DIFF BUNDLES ─────────────────────────────────────────────────────────────

/**
 * Compute entity diff between two bundles (prev → next).
 * Returns { added, modified, removed } record counts per section.
 */
export function diffBundles(store, fromBundleId, toBundleId) {
  const from = store.bundles?.[fromBundleId];
  const to   = store.bundles?.[toBundleId];
  if (!from) throw new Error(`Source bundle not found: ${fromBundleId}`);
  if (!to)   throw new Error(`Target bundle not found: ${toBundleId}`);

  const sections = [BUNDLE_SECTION.DRIVERS, BUNDLE_SECTION.VEHICLES,
                    BUNDLE_SECTION.DEVICES, BUNDLE_SECTION.PERMISSIONS,
                    BUNDLE_SECTION.IDENTITIES];
  const diff = {};

  for (const section of sections) {
    const fromRecs = _indexById(from.sections[section]?.records || []);
    const toRecs   = _indexById(to.sections[section]?.records   || []);

    const added    = Object.keys(toRecs).filter(id => !fromRecs[id]);
    const removed  = Object.keys(fromRecs).filter(id => !toRecs[id]);
    const modified = Object.keys(toRecs).filter(id =>
      fromRecs[id] &&
      JSON.stringify(fromRecs[id]) !== JSON.stringify(toRecs[id])
    );

    diff[section] = { added: added.length, modified: modified.length, removed: removed.length };
  }

  return diff;
}

/**
 * Get a stored bundle by ID.
 */
export function getBundle(store, bundleId) {
  const b = store.bundles?.[bundleId];
  if (!b) throw new Error(`Bundle not found: ${bundleId}`);
  return b;
}

/**
 * List all bundles for a fleet.
 */
export function listBundles(store, fleetId) {
  return Object.values(store.bundles || {})
    .filter(b => b.fleetId === fleetId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ─── PACK: FULL ───────────────────────────────────────────────────────────────

function _packFull(store, bundleId, deploymentId, fleetId, fleet, version, options, now) {
  const brand      = getFleetBrand(store, fleetId);
  const drivers    = _fleetEntities(store.drivers,     fleetId);
  const vehicles   = _fleetEntities(store.vehicles,    fleetId);
  const devices    = _fleetEntities(store.devices,     fleetId);
  const perms      = _fleetEntities(store.permissions, fleetId);
  const identities = _fleetEntities(store.identities,  fleetId);
  const routes     = _activeRoutes(store, fleetId);

  const sections = {
    [BUNDLE_SECTION.MANIFEST]:    _manifest(bundleId, deploymentId, fleetId, version, BUNDLE_TARGET.FULL, now),
    [BUNDLE_SECTION.CONFIG]:      { fleetId, regulation: fleet.regulation, rules: fleet.config?.rules || {}, deployedAt: now },
    [BUNDLE_SECTION.BRANDING]:    brand || {},
    [BUNDLE_SECTION.DRIVERS]:     { records: drivers,    count: drivers.length },
    [BUNDLE_SECTION.VEHICLES]:    { records: vehicles,   count: vehicles.length },
    [BUNDLE_SECTION.DEVICES]:     { records: devices,    count: devices.length },
    [BUNDLE_SECTION.PERMISSIONS]: { records: perms,      count: perms.length },
    [BUNDLE_SECTION.IDENTITIES]:  { records: identities, count: identities.length },
    [BUNDLE_SECTION.ROUTES]:      { records: routes,     count: routes.length },
    [BUNDLE_SECTION.ENV_VARS]:    options.envVars || {}
  };

  const checksum = _checksum(sections);
  sections[BUNDLE_SECTION.MANIFEST].checksum = checksum;

  return {
    id:                bundleId,
    deploymentId,
    fleetId,
    target:            BUNDLE_TARGET.FULL,
    version,
    createdAt:         now,
    checksum,
    sizeEstimateBytes: _estimateSize(sections),
    sections,
    diff:              null
  };
}

// ─── PACK: INCREMENTAL ────────────────────────────────────────────────────────

function _packIncremental(store, bundleId, deploymentId, fleetId, fleet, version, options, now) {
  const fromBundle = options.fromId ? store.bundles?.[options.fromId] : null;

  // Fall back to full if no prior bundle
  if (!fromBundle) return _packFull(store, bundleId, deploymentId, fleetId, fleet, version, options, now);

  const nextFull   = _packFull(store, bundleId + "_tmp", deploymentId, fleetId, fleet, version, options, now);
  const sections   = { ...nextFull.sections };

  // Compute diffs per entity section
  const diffSections = [BUNDLE_SECTION.DRIVERS, BUNDLE_SECTION.VEHICLES,
                        BUNDLE_SECTION.DEVICES, BUNDLE_SECTION.PERMISSIONS,
                        BUNDLE_SECTION.IDENTITIES];
  const diff = {};

  for (const sec of diffSections) {
    const fromRecs = _indexById(fromBundle.sections[sec]?.records || []);
    const toRecs   = _indexById(sections[sec]?.records            || []);

    const added    = Object.values(toRecs).filter(r => !fromRecs[r.id]);
    const removed  = Object.keys(fromRecs).filter(id => !toRecs[id]);
    const modified = Object.values(toRecs).filter(r =>
      fromRecs[r.id] && JSON.stringify(fromRecs[r.id]) !== JSON.stringify(r)
    );

    diff[sec]        = { added: added.length, modified: modified.length, removed: removed.length };
    sections[sec]    = { records: [...added, ...modified], removedIds: removed, count: added.length + modified.length };
  }

  const manifest    = _manifest(bundleId, deploymentId, fleetId, version, BUNDLE_TARGET.INCREMENTAL, now);
  manifest.fromId   = options.fromId;
  manifest.checksum = _checksum(sections);
  sections[BUNDLE_SECTION.MANIFEST] = manifest;

  return {
    id:                bundleId,
    deploymentId,
    fleetId,
    target:            BUNDLE_TARGET.INCREMENTAL,
    version,
    createdAt:         now,
    checksum:          manifest.checksum,
    sizeEstimateBytes: _estimateSize(sections),
    fromBundleId:      options.fromId,
    sections,
    diff
  };
}

// ─── PACK: CONFIG ONLY ────────────────────────────────────────────────────────

function _packConfig(store, bundleId, deploymentId, fleetId, fleet, version, options, now) {
  const brand    = getFleetBrand(store, fleetId);
  const sections = {
    [BUNDLE_SECTION.MANIFEST]: _manifest(bundleId, deploymentId, fleetId, version, BUNDLE_TARGET.CONFIG_ONLY, now),
    [BUNDLE_SECTION.CONFIG]:   { fleetId, regulation: fleet.regulation, rules: fleet.config?.rules || {}, deployedAt: now },
    [BUNDLE_SECTION.BRANDING]: brand || {},
    [BUNDLE_SECTION.ENV_VARS]: options.envVars || {}
  };
  const checksum = _checksum(sections);
  sections[BUNDLE_SECTION.MANIFEST].checksum = checksum;
  return { id: bundleId, deploymentId, fleetId, target: BUNDLE_TARGET.CONFIG_ONLY,
           version, createdAt: now, checksum, sizeEstimateBytes: _estimateSize(sections), sections, diff: null };
}

// ─── PACK: PWA ONLY ───────────────────────────────────────────────────────────

function _packPwa(store, bundleId, deploymentId, fleetId, fleet, version, options, now) {
  const brand    = getFleetBrand(store, fleetId);
  const drivers  = _fleetEntities(store.drivers, fleetId).map(d => ({
    id: d.id, name: d.name, fleetId: d.fleetId, regulation: d.regulation
  }));
  const sections = {
    [BUNDLE_SECTION.MANIFEST]: _manifest(bundleId, deploymentId, fleetId, version, BUNDLE_TARGET.PWA_ONLY, now),
    [BUNDLE_SECTION.CONFIG]:   { fleetId, regulation: fleet.regulation, deployedAt: now },
    [BUNDLE_SECTION.BRANDING]: brand || {},
    [BUNDLE_SECTION.DRIVERS]:  { records: drivers, count: drivers.length },
    [BUNDLE_SECTION.ENV_VARS]: options.envVars || {}
  };
  const checksum = _checksum(sections);
  sections[BUNDLE_SECTION.MANIFEST].checksum = checksum;
  return { id: bundleId, deploymentId, fleetId, target: BUNDLE_TARGET.PWA_ONLY,
           version, createdAt: now, checksum, sizeEstimateBytes: _estimateSize(sections), sections, diff: null };
}

// ─── PACK: ROLLBACK ───────────────────────────────────────────────────────────

function _packRollback(store, bundleId, deploymentId, fleetId, fleet, version, options, now) {
  const fromBundle = store.bundles?.[options.fromId];
  if (!fromBundle) throw new Error(`Rollback source bundle not found: ${options.fromId}`);

  // Rollback bundle = copy of the prior bundle with new metadata
  const sections  = { ...fromBundle.sections };
  const manifest  = _manifest(bundleId, deploymentId, fleetId, version, BUNDLE_TARGET.ROLLBACK, now);
  manifest.rollbackFromBundleId = options.fromId;
  manifest.rollbackToVersion    = fromBundle.version;
  manifest.checksum             = _checksum(sections);
  sections[BUNDLE_SECTION.MANIFEST] = manifest;

  return {
    id:                bundleId,
    deploymentId,
    fleetId,
    target:            BUNDLE_TARGET.ROLLBACK,
    version,
    createdAt:         now,
    checksum:          manifest.checksum,
    sizeEstimateBytes: _estimateSize(sections),
    rollbackFromId:    options.fromId,
    rollbackToVersion: fromBundle.version,
    sections,
    diff:              null
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function _manifest(bundleId, deploymentId, fleetId, version, target, createdAt) {
  return {
    bundleId, deploymentId, fleetId, version,
    target, createdAt, checksum: null   // filled after sections built
  };
}

function _fleetEntities(collection, fleetId) {
  return Object.values(collection || {}).filter(e => e.fleetId === fleetId);
}

function _activeRoutes(store, fleetId) {
  return Object.values(store.routes || {})
    .filter(r => r.fleetId === fleetId && (r.status === "active" || r.status === "pending"))
    .slice(0, 100);
}

function _indexById(records) {
  return Object.fromEntries((records || []).map(r => [r.id, r]));
}

function _checksum(sections) {
  // Deterministic checksum: JSON.stringify → simple djb2 hash
  const str  = JSON.stringify(sections);
  let hash   = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;  // 32-bit int
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function _estimateSize(sections) {
  return new TextEncoder().encode(JSON.stringify(sections)).length;
}
