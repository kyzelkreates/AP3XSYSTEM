// AP3X Rollback Manager
// Executes rollback from a failed or unwanted deployment to a prior stable version.
// Three strategies: IMMEDIATE, GRACEFUL, CANARY_ABORT.
// Only the Master Controller can invoke rollback. Fleet OS cannot.

import { ROLLBACK_STRATEGY, DEPLOY_STATUS, BUNDLE_TARGET } from "./deployment-constants.js";
import { getActiveDeployment, getRollbackCandidates,
         failVersion, activateVersion }                    from "./version-manager.js";
import { packFleet }                                       from "./build-packager.js";
import { emitEvent }                                       from "../event-emitter.js";

// ─── EXECUTE ROLLBACK ─────────────────────────────────────────────────────────

/**
 * Roll back a fleet to a previous stable deployment.
 *
 * @param {object} store
 * @param {string} fleetId
 * @param {object} options
 *   strategy:     ROLLBACK_STRATEGY.*   (default: IMMEDIATE)
 *   targetId:     string                specific deployment to roll back to (optional)
 *   reason:       string                human note for audit trail
 *   initiatedBy:  string                "master_controller" — enforced
 * @returns {RollbackResult}
 */
export function executeRollback(store, fleetId, options = {}) {
  const strategy    = options.strategy   || ROLLBACK_STRATEGY.IMMEDIATE;
  const reason      = options.reason     || "Manual rollback";
  const initiatedBy = options.initiatedBy || "master_controller";

  // RULE: only Master Controller can initiate rollback
  if (initiatedBy !== "master_controller") {
    throw new Error("Rollback can only be initiated by the Master Controller");
  }

  const current  = getActiveDeployment(store, fleetId);
  const target   = options.targetId
    ? store.deployments?.[options.targetId]
    : _bestCandidate(store, fleetId);

  if (!target) throw new Error(`No rollback target found for fleet: ${fleetId}`);
  if (target.id === current?.id) throw new Error("Cannot roll back to currently active deployment");

  const rollbackId = crypto.randomUUID();
  const now        = Date.now();

  emitEvent(store, {
    type:     "deployment.rollback.initiated",
    fleetId,
    entityId: rollbackId,
    payload:  {
      rollbackId, strategy, reason,
      fromDeploymentId:    current?.id || null,
      fromVersion:         current?.version || null,
      toDeploymentId:      target.id,
      toVersion:           target.version
    }
  });

  let result;
  switch (strategy) {
    case ROLLBACK_STRATEGY.IMMEDIATE:
      result = _immediateRollback(store, fleetId, current, target, rollbackId, reason, now);
      break;
    case ROLLBACK_STRATEGY.GRACEFUL:
      result = _gracefulRollback(store, fleetId, current, target, rollbackId, reason, now);
      break;
    case ROLLBACK_STRATEGY.CANARY_ABORT:
      result = _canaryAbort(store, fleetId, current, target, rollbackId, reason, now);
      break;
    default:
      throw new Error(`Unknown rollback strategy: ${strategy}`);
  }

  return result;
}

// ─── IMMEDIATE ROLLBACK ───────────────────────────────────────────────────────

function _immediateRollback(store, fleetId, current, target, rollbackId, reason, now) {
  // 1. Fail the current deployment
  if (current) {
    current.status        = DEPLOY_STATUS.ROLLED_BACK;
    current.rolledBackAt  = now;
    current.rollbackReason = reason;
  }

  // 2. Build a rollback bundle from the target's bundle
  const rollbackDeploymentId = crypto.randomUUID();
  const rollbackBundle = packFleet(store, rollbackDeploymentId, fleetId, {
    target:   BUNDLE_TARGET.ROLLBACK,
    version:  _rollbackVersion(target.version),
    fromId:   target.bundleId,
    envVars:  {}
  });

  // 3. Register and immediately activate the rollback deployment
  const rollbackDep = {
    id:             rollbackDeploymentId,
    fleetId,
    version:        rollbackBundle.version,
    status:         DEPLOY_STATUS.ACTIVE,
    bundleId:       rollbackBundle.id,
    target:         target.target,
    changelog:      [`Rollback to ${target.version}: ${reason}`],
    pinned:         false,
    rollbackFromId: current?.id || null,
    createdAt:      now,
    activatedAt:    now,
    supersededAt:   null,
    healthChecks:   [],
    failureReason:  null
  };

  // Supersede everything else
  Object.values(store.deployments)
    .filter(d => d.fleetId === fleetId && d.status === DEPLOY_STATUS.ACTIVE && d.id !== rollbackDeploymentId)
    .forEach(d => { d.status = DEPLOY_STATUS.SUPERSEDED; d.supersededAt = now; });

  store.deployments[rollbackDeploymentId] = rollbackDep;

  emitEvent(store, {
    type:     "deployment.rollback.complete",
    fleetId,
    entityId: rollbackDeploymentId,
    payload:  {
      rollbackId,
      strategy:              ROLLBACK_STRATEGY.IMMEDIATE,
      newDeploymentId:       rollbackDeploymentId,
      restoredVersion:       target.version,
      fromDeploymentId:      current?.id || null,
      durationMs:            Date.now() - now
    }
  });

  return {
    success:            true,
    strategy:           ROLLBACK_STRATEGY.IMMEDIATE,
    rollbackId,
    newDeploymentId:    rollbackDeploymentId,
    restoredVersion:    target.version,
    fromVersion:        current?.version || null,
    bundleId:           rollbackBundle.id,
    completedAt:        now
  };
}

// ─── GRACEFUL ROLLBACK ────────────────────────────────────────────────────────
// Marks the current deployment as pending rollback — actual cut happens
// once in-flight tacho sessions and routes are closed.
// The orchestrator polls and completes the rollback via _immediateRollback.

function _gracefulRollback(store, fleetId, current, target, rollbackId, reason, now) {
  if (current) {
    current.status            = "pending_rollback";
    current.rollbackPendingAt = now;
    current.rollbackReason    = reason;
    current.rollbackTargetId  = target.id;
    current.rollbackId        = rollbackId;
  }

  emitEvent(store, {
    type:     "deployment.rollback.pending",
    fleetId,
    entityId: rollbackId,
    payload:  {
      rollbackId, reason,
      fromDeploymentId: current?.id  || null,
      toDeploymentId:   target.id,
      toVersion:        target.version,
      awaitingClose:    _activeSessions(store, fleetId)
    }
  });

  return {
    success:          true,
    strategy:         ROLLBACK_STRATEGY.GRACEFUL,
    rollbackId,
    status:           "pending",
    fromVersion:      current?.version || null,
    targetVersion:    target.version,
    awaitingClose:    _activeSessions(store, fleetId),
    scheduledAt:      now
  };
}

// ─── CANARY ABORT ─────────────────────────────────────────────────────────────
// Aborts a deployment that was promoted as canary — immediately cuts traffic
// back to the previous full deployment.

function _canaryAbort(store, fleetId, current, target, rollbackId, reason, now) {
  // Mark current as failed (not rolled_back — canary was never fully live)
  if (current) {
    current.status        = DEPLOY_STATUS.FAILED;
    current.failureReason = `Canary aborted: ${reason}`;
    current.abortedAt     = now;
  }

  // Restore the target immediately
  return _immediateRollback(store, fleetId,
    { ...current, status: DEPLOY_STATUS.FAILED },
    target, rollbackId, reason, now
  );
}

// ─── ROLLBACK STATUS ──────────────────────────────────────────────────────────

/**
 * Check if a graceful rollback is ready to execute.
 * Returns true if all tacho sessions and active routes are closed.
 */
export function isGracefulRollbackReady(store, fleetId) {
  const sessions = _activeSessions(store, fleetId);
  return sessions.driverSessions === 0 && sessions.activeRoutes === 0;
}

/**
 * Complete a pending graceful rollback — call this from the orchestrator's
 * polling loop after isGracefulRollbackReady returns true.
 */
export function completeGracefulRollback(store, fleetId) {
  const current = Object.values(store.deployments)
    .find(d => d.fleetId === fleetId && d.status === "pending_rollback");
  if (!current) throw new Error("No pending rollback found for fleet");

  const target = store.deployments?.[current.rollbackTargetId];
  if (!target) throw new Error("Rollback target deployment not found");

  return _immediateRollback(store, fleetId, current, target,
    current.rollbackId, current.rollbackReason, Date.now());
}

// ─── AUDIT ────────────────────────────────────────────────────────────────────

/**
 * Full rollback history for a fleet.
 */
export function getRollbackHistory(store, fleetId) {
  return store.events
    .filter(e =>
      e.fleetId === fleetId &&
      (e.type === "deployment.rollback.complete" ||
       e.type === "deployment.rollback.pending"  ||
       e.type === "deployment.rollback.initiated")
    )
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _bestCandidate(store, fleetId) {
  return getRollbackCandidates(store, fleetId, 1)[0] || null;
}

function _rollbackVersion(targetVersion) {
  // e.g. 2.3.1-rollback
  return `${targetVersion}-rb`;
}

function _activeSessions(store, fleetId) {
  const driverSessions = Object.values(store.tacho || {})
    .filter(s => s.fleetId === fleetId && s.status === "active").length;
  const activeRoutes   = Object.values(store.routes || {})
    .filter(r => r.fleetId === fleetId && r.status === "active").length;
  return { driverSessions, activeRoutes };
}
