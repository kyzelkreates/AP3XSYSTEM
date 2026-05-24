// AP3X Reconciler — RUN 10
// State reconciliation engine.
// Compares server snapshot against local state and produces a reconciliation plan.
// Applies the plan field-by-field with audit trail.
// Called during offline → online merge and periodic full-sync cycles.
// NO UI. NO routing. NO fleet logic changes.

import {
  SYNC_OP, SYNC_ENTITY, CONFLICT_STRATEGY,
  ENTITY_CONFLICT_STRATEGY, MERGE_RULES
} from "./sync-constants.js";
import { detectConflict, resolveConflict, scanForConflicts } from "./conflict-resolver.js";

// ─── RECONCILIATION PLAN ──────────────────────────────────────────────────────

/**
 * @typedef {object} ReconciliationPlan
 * @property {string}   id            - Plan UUID
 * @property {string}   entityType    - SYNC_ENTITY.*
 * @property {string}   entityId
 * @property {string}   action        - "apply_server" | "apply_client" | "merge" | "no_op" | "escalate"
 * @property {object}   resolved      - Merged state to apply
 * @property {string[]} appliedFields
 * @property {string[]} droppedFields
 * @property {string}   notes
 * @property {object}   clientState
 * @property {object}   serverState
 * @property {boolean}  applied       - Has this plan been executed
 */

// ─── RECONCILE ENTITY ─────────────────────────────────────────────────────────

/**
 * Reconcile a single entity between client and server states.
 * Returns a ReconciliationPlan — does not apply it directly.
 * Caller must apply via applyPlan().
 *
 * @param {string} entityType  - SYNC_ENTITY.*
 * @param {string} entityId
 * @param {object} clientState - Local state on device/buffer
 * @param {object} serverState - Authoritative server state
 * @returns {ReconciliationPlan}
 */
export function reconcileEntity(entityType, entityId, clientState, serverState) {
  // ── No server state: client creates ───────────────────────────────────────
  if (!serverState) {
    return _plan(entityType, entityId, "apply_client", {
      resolved:      { ...clientState },
      appliedFields: Object.keys(clientState || {}),
      droppedFields: [],
      notes:         "No server record — client state applied as create",
      clientState,
      serverState:   null
    });
  }

  // ── No client state: server wins ──────────────────────────────────────────
  if (!clientState) {
    return _plan(entityType, entityId, "apply_server", {
      resolved:      { ...serverState },
      appliedFields: Object.keys(serverState || {}),
      droppedFields: [],
      notes:         "No client state — server record applied",
      clientState:   null,
      serverState
    });
  }

  // ── Both states exist: run conflict detection ──────────────────────────────
  const fakeItem = {
    id:          crypto.randomUUID(),
    entityType,
    entityId,
    payload:     clientState,
    enqueuedAt:  clientState.updatedAt || Date.now(),
    vectorClock: clientState.vectorClock || null
  };

  const report = detectConflict(fakeItem, serverState);

  // ── No conflict: timestamps agree, fields match ───────────────────────────
  if (!report.isConflict) {
    // Check if client has new data server doesn't
    const clientNewer = (clientState.updatedAt || 0) > (serverState.updatedAt || 0);
    if (!clientNewer) {
      return _plan(entityType, entityId, "no_op", {
        resolved:      { ...serverState },
        appliedFields: [],
        droppedFields: [],
        notes:         "States in sync — no action required",
        clientState,
        serverState
      });
    }
    // Client is newer — apply client
    return _plan(entityType, entityId, "apply_client", {
      resolved:      { ...clientState, updatedAt: Date.now() },
      appliedFields: Object.keys(clientState),
      droppedFields: [],
      notes:         "Client state is newer — applied to server",
      clientState,
      serverState
    });
  }

  // ── Conflict: resolve via strategy ────────────────────────────────────────
  const resolution = resolveConflict(fakeItem, serverState, report);
  const action     = _strategyToAction(resolution.strategy);

  return _plan(entityType, entityId, action, {
    resolved:      resolution.resolved,
    appliedFields: resolution.appliedFields,
    droppedFields: resolution.droppedFields,
    notes:         `[${resolution.strategy}] ${resolution.notes} | Conflict: ${report.reason}`,
    clientState,
    serverState,
    conflictReport: report
  });
}

// ─── FULL SNAPSHOT RECONCILE ─────────────────────────────────────────────────

/**
 * Reconcile an entire entity collection between client snapshot and server snapshot.
 * Used for offline → online merge: compare entire local store vs server pull.
 *
 * @param {string}          entityType
 * @param {Map<id, object>} clientMap  - Local store (entityId → record)
 * @param {Map<id, object>} serverMap  - Server pull (entityId → record)
 * @returns {ReconciliationBatch}
 *   { plans, stats: { noop, applied, conflicts, created, escalated } }
 */
export function reconcileSnapshot(entityType, clientMap, serverMap) {
  const plans = [];
  const allIds = new Set([...clientMap.keys(), ...serverMap.keys()]);

  for (const id of allIds) {
    const clientState = clientMap.get(id) || null;
    const serverState = serverMap.get(id) || null;
    const plan        = reconcileEntity(entityType, id, clientState, serverState);
    plans.push(plan);
  }

  const stats = _summariseStats(plans);
  return { plans, stats, entityType, reconciledAt: Date.now() };
}

// ─── APPLY PLAN ───────────────────────────────────────────────────────────────

/**
 * Apply a reconciliation plan to the store.
 * Returns the final applied record, or null for no-ops.
 *
 * @param {ReconciliationPlan} plan
 * @param {object}             store      - SSOT (AP3X store)
 * @param {string}             collection - store key (e.g. "hazards", "tacho")
 */
export function applyPlan(plan, store, collection) {
  if (plan.action === "no_op" || plan.action === "escalate") {
    plan.applied = false;
    return null;
  }

  if (!store[collection]) store[collection] = {};

  const target = plan.resolved;
  target.reconciledAt = Date.now();
  target.vectorClock  = target.vectorClock || `reconciler:${Date.now()}`;

  store[collection][plan.entityId] = target;
  plan.applied = true;

  return target;
}

/**
 * Apply an entire batch of reconciliation plans.
 * @param {ReconciliationBatch} batch
 * @param {object}              store
 * @param {string}              collection
 * @returns {{ applied, skipped, errors }}
 */
export function applyBatch(batch, store, collection) {
  let applied = 0, skipped = 0;
  const errors = [];

  for (const plan of batch.plans) {
    try {
      const result = applyPlan(plan, store, collection);
      result ? applied++ : skipped++;
    } catch (err) {
      errors.push({ planId: plan.id, entityId: plan.entityId, error: err.message });
    }
  }

  return { applied, skipped, errors };
}

// ─── TACHO ACCUMULATOR RECONCILE ─────────────────────────────────────────────
// Specialised reconciler for tachograph accumulators.
// Merges session-level data — accumulator values are strictly additive.

/**
 * Reconcile two tachograph accumulators (client vs server).
 * Always produces a "safe" accumulator — never decrements time.
 */
export function reconcileTachoAccum(clientAccum, serverAccum) {
  if (!clientAccum && !serverAccum) return {};
  if (!clientAccum) return { ...serverAccum };
  if (!serverAccum) return { ...clientAccum };

  const additiveFields = MERGE_RULES.tacho.additive;
  const resolved       = { ...serverAccum };

  for (const field of additiveFields) {
    const cv = Number(clientAccum[field]) || 0;
    const sv = Number(serverAccum[field]) || 0;
    resolved[field] = Math.max(cv, sv); // never decrease accumulated time
  }

  // Violations: union of both (server may have more from other sessions)
  if (clientAccum.violations && serverAccum.violations) {
    const seen    = new Set(serverAccum.violations.map(v => v.code + v.timestamp));
    const merged  = [...serverAccum.violations];
    for (const v of clientAccum.violations) {
      if (!seen.has(v.code + v.timestamp)) merged.push(v);
    }
    resolved.violations = merged.sort((a, b) => a.timestamp - b.timestamp);
  }

  resolved.reconciledAt = Date.now();
  return resolved;
}

// ─── HAZARD MERGE ─────────────────────────────────────────────────────────────

/**
 * Merge a client-reported hazard with its server counterpart.
 * Confirmations and rejections are additive.
 * Status and severity are server-authoritative.
 */
export function reconcileHazard(clientHazard, serverHazard) {
  if (!serverHazard) return { ...clientHazard };

  return {
    ...serverHazard,
    confirmations: Math.max(
      (serverHazard.confirmations || 0),
      (clientHazard.confirmations || 0)
    ),
    rejections: Math.max(
      (serverHazard.rejections || 0),
      (clientHazard.rejections || 0)
    ),
    description:   clientHazard.description || serverHazard.description,
    tags:          _mergeTags(clientHazard.tags, serverHazard.tags),
    reconciledAt:  Date.now()
  };
}

// ─── OFFLINE MERGE PIPELINE ───────────────────────────────────────────────────

/**
 * Full offline → online merge pipeline.
 * Call this when a device comes back online after an extended offline period.
 *
 * Steps:
 *   1. Pull server snapshot
 *   2. Reconcile each entity collection
 *   3. Identify and resolve conflicts
 *   4. Produce ordered apply plan
 *   5. Return batch ready for applyBatch()
 *
 * @param {object} localStore   - Device's local state (sub-collections)
 * @param {object} serverStore  - Server's current state (same shape)
 * @param {string[]} collections - Which collections to reconcile
 * @returns {MergePipeline} { batches, totalConflicts, totalApplied, ready }
 */
export function buildOfflineMergePipeline(localStore, serverStore, collections) {
  const batches        = {};
  let   totalConflicts = 0;
  let   totalApplied   = 0;

  for (const col of collections) {
    const clientMap = _toMap(localStore[col] || {});
    const serverMap = _toMap(serverStore[col] || {});
    const entityType= _colToEntityType(col);

    const batch = reconcileSnapshot(entityType, clientMap, serverMap);
    batches[col] = batch;

    totalConflicts += batch.stats.conflicts;
    totalApplied   += batch.stats.applied + batch.stats.created;
  }

  return {
    batches,
    totalConflicts,
    totalApplied,
    reconciledAt: Date.now(),
    ready: true
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _plan(entityType, entityId, action, fields) {
  return {
    id:      crypto.randomUUID(),
    entityType,
    entityId,
    action,
    applied: false,
    ...fields
  };
}

function _strategyToAction(strategy) {
  switch (strategy) {
    case CONFLICT_STRATEGY.SERVER_WINS:  return "apply_server";
    case CONFLICT_STRATEGY.CLIENT_WINS:  return "apply_client";
    case CONFLICT_STRATEGY.MERGE_FIELDS: return "merge";
    case CONFLICT_STRATEGY.LAST_WRITE:   return "merge";
    case CONFLICT_STRATEGY.MANUAL:       return "escalate";
    default:                             return "apply_server";
  }
}

function _summariseStats(plans) {
  const stats = { noop: 0, applied: 0, conflicts: 0, created: 0, escalated: 0 };
  for (const p of plans) {
    if (p.action === "no_op")         stats.noop++;
    else if (p.action === "escalate") stats.escalated++;
    else if (!p.serverState)          stats.created++;
    else if (p.conflictReport)        stats.conflicts++;
    else                              stats.applied++;
  }
  return stats;
}

function _toMap(obj) {
  return new Map(Object.entries(obj || {}));
}

function _colToEntityType(col) {
  const map = {
    routes:   "route",
    hazards:  "hazard",
    tacho:    "tacho",
    drivers:  "driver",
    devices:  "device"
  };
  return map[col] || col;
}

function _mergeTags(clientTags = [], serverTags = []) {
  return [...new Set([...serverTags, ...clientTags])].slice(0, 10);
}
