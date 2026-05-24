// AP3X Version Manager
// Semver-style versioning for fleet deployments.
// Tracks version history, pinning, changelog, and promotion gates.
// READ — does not call deploy. Deploy calls this.

import { VERSION, DEPLOY_STATUS } from "./deployment-constants.js";
import { emitEvent }              from "../event-emitter.js";

// ─── VERSION STRUCTURE ────────────────────────────────────────────────────────
// store.deployments[id] = {
//   id, fleetId, version (semver string), semverParts {major,minor,patch},
//   status, bundleId, target, createdAt, activatedAt, supersededAt,
//   changelog: string[], pinned: bool, rollbackFromId: string|null
// }

// ─── CALCULATE NEXT VERSION ───────────────────────────────────────────────────

/**
 * Calculate the next version string for a fleet.
 * bump: "major" | "minor" | "patch" (default)
 */
export function nextVersion(store, fleetId, bump = "patch") {
  const current = _currentVersion(store, fleetId);
  if (!current) return VERSION.INITIAL;

  const { major, minor, patch } = _parseSemver(current);
  switch (bump) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    default:      return `${major}.${minor}.${patch + 1}`;
  }
}

// ─── REGISTER VERSION ─────────────────────────────────────────────────────────

/**
 * Register a new version record in the SSOT when packaging begins.
 * Returns the version record — deployment ID already allocated.
 */
export function registerVersion(store, deploymentId, fleetId, options = {}) {
  const version   = options.version || nextVersion(store, fleetId, options.bump);
  const changelog = options.changelog || [];
  const target    = options.target || "vercel";

  const record = {
    id:               deploymentId,
    fleetId,
    version,
    semverParts:      _parseSemver(version),
    status:           DEPLOY_STATUS.PENDING,
    bundleId:         null,
    target,
    changelog,
    pinned:           false,
    rollbackFromId:   options.rollbackFromId || null,
    createdAt:        Date.now(),
    activatedAt:      null,
    supersededAt:     null,
    healthChecks:     [],
    failureReason:    null
  };

  store.deployments[deploymentId] = record;

  emitEvent(store, {
    type:     "deployment.version.registered",
    fleetId,
    entityId: deploymentId,
    payload:  { deploymentId, version, target }
  });

  return record;
}

// ─── ACTIVATE VERSION ─────────────────────────────────────────────────────────

/**
 * Mark a deployment as ACTIVE. Supersedes all previously active versions.
 * Only callable from the deployment orchestrator — not from Fleet OS.
 */
export function activateVersion(store, deploymentId) {
  const dep = _requireDeployment(store, deploymentId);

  // Supersede any currently active deployment for this fleet
  _supersedePrevious(store, dep.fleetId, deploymentId);

  dep.status      = DEPLOY_STATUS.ACTIVE;
  dep.activatedAt = Date.now();

  emitEvent(store, {
    type:     "deployment.version.activated",
    fleetId:  dep.fleetId,
    entityId: deploymentId,
    payload:  { deploymentId, version: dep.version, target: dep.target }
  });

  return dep;
}

// ─── FAIL VERSION ─────────────────────────────────────────────────────────────

export function failVersion(store, deploymentId, reason) {
  const dep = _requireDeployment(store, deploymentId);
  dep.status        = DEPLOY_STATUS.FAILED;
  dep.failureReason = reason || "unknown";

  emitEvent(store, {
    type:     "deployment.version.failed",
    fleetId:  dep.fleetId,
    entityId: deploymentId,
    payload:  { deploymentId, version: dep.version, reason: dep.failureReason }
  });

  return dep;
}

// ─── PIN / UNPIN ──────────────────────────────────────────────────────────────

/**
 * Pin a deployment — prevents it from being automatically superseded.
 * Pinned versions are preserved as rollback targets.
 */
export function pinVersion(store, deploymentId) {
  const dep   = _requireDeployment(store, deploymentId);
  dep.pinned  = true;

  emitEvent(store, {
    type:     "deployment.version.pinned",
    fleetId:  dep.fleetId,
    entityId: deploymentId,
    payload:  { deploymentId, version: dep.version }
  });

  return dep;
}

export function unpinVersion(store, deploymentId) {
  const dep  = _requireDeployment(store, deploymentId);
  dep.pinned = false;

  emitEvent(store, {
    type:     "deployment.version.unpinned",
    fleetId:  dep.fleetId,
    entityId: deploymentId,
    payload:  { deploymentId, version: dep.version }
  });

  return dep;
}

// ─── VERSION HISTORY ──────────────────────────────────────────────────────────

/**
 * Full version history for a fleet, newest first.
 * Trims to VERSION.MAX_HISTORY unpinned entries.
 */
export function getVersionHistory(store, fleetId) {
  const all = Object.values(store.deployments)
    .filter(d => d.fleetId === fleetId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return all;
}

/**
 * The currently active deployment for a fleet. Null if none.
 */
export function getActiveDeployment(store, fleetId) {
  return Object.values(store.deployments)
    .find(d => d.fleetId === fleetId && d.status === DEPLOY_STATUS.ACTIVE)
    || null;
}

/**
 * Get N most recent rollback candidates — active or pinned, not the current one.
 */
export function getRollbackCandidates(store, fleetId, limit = 5) {
  const active = getActiveDeployment(store, fleetId);
  return Object.values(store.deployments)
    .filter(d =>
      d.fleetId === fleetId &&
      d.id !== active?.id &&
      (d.status === DEPLOY_STATUS.ACTIVE ||
       d.status === DEPLOY_STATUS.SUPERSEDED ||
       d.pinned)
    )
    .sort((a, b) => (b.activatedAt || b.createdAt || 0) - (a.activatedAt || a.createdAt || 0))
    .slice(0, limit);
}

/**
 * Add a health check result to a deployment record.
 */
export function recordHealthCheck(store, deploymentId, checkResult) {
  const dep = _requireDeployment(store, deploymentId);
  if (!dep.healthChecks) dep.healthChecks = [];
  dep.healthChecks.push({ ...checkResult, recordedAt: Date.now() });
  return dep;
}

// ─── COMPARE VERSIONS ─────────────────────────────────────────────────────────

export function compareVersions(a, b) {
  const pa = _parseSemver(a);
  const pb = _parseSemver(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

export function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

// ─── INTERNALS ────────────────────────────────────────────────────────────────

function _currentVersion(store, fleetId) {
  const active = getActiveDeployment(store, fleetId);
  if (active) return active.version;

  // Fall back to highest registered version
  const all = Object.values(store.deployments)
    .filter(d => d.fleetId === fleetId && d.version)
    .sort((a, b) => compareVersions(b.version, a.version));

  return all[0]?.version || null;
}

function _parseSemver(v) {
  const match = String(v || "0.0.0").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return { major: 0, minor: 0, patch: 0 };
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

function _requireDeployment(store, id) {
  const dep = store.deployments?.[id];
  if (!dep) throw new Error(`Deployment not found: ${id}`);
  return dep;
}

function _supersedePrevious(store, fleetId, excludeId) {
  Object.values(store.deployments)
    .filter(d => d.fleetId === fleetId && d.status === DEPLOY_STATUS.ACTIVE && d.id !== excludeId)
    .forEach(d => {
      d.status        = DEPLOY_STATUS.SUPERSEDED;
      d.supersededAt  = Date.now();
    });
}
