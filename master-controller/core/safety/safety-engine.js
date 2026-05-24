// AP3X Safety AI Gatekeeper — RUN 5 (CORE ENGINE)
// ═══════════════════════════════════════════════════════════════════════════════
// IMMUTABLE CONTRACT:
//   - This engine NEVER modifies a route. Read-only from SSOT.
//   - It produces a SafetyDecision record and stores it in store.safetyDecisions.
//   - If decision is REJECTED or CRITICAL, the routing engine is blocked.
//   - No AI inference here — deterministic rule engine only.
//   - RUN 5 scope: compliance + risk scoring + approve/reject.
//   - AI fatigue / behavioural analysis comes in RUN 6+.
// ═══════════════════════════════════════════════════════════════════════════════

import { emitEvent }  from "../event-emitter.js";
import { scoreRoute } from "./risk-scorer.js";
import {
  RISK_LEVEL,
  DECISION,
  RISK_BANDS,
  LEGAL_RULES
} from "./safety-constants.js";

// ─── MAIN GATEKEEPER ─────────────────────────────────────────────────────────

/**
 * Run the safety gate on a route before execution.
 * Called by the routing API layer — route cannot execute without APPROVED decision.
 *
 * @param {object} store    - AP3X SSOT (read-only)
 * @param {string} routeId  - route to evaluate
 * @param {object} options  - { requestedBy?, notes? }
 * @returns {SafetyDecision}
 */
export function evaluateRoute(store, routeId, options = {}) {
  // ── 1. Resolve route ─────────────────────────────────────────────────────
  const route = store.routes?.[routeId];
  if (!route) throw new Error(`Route not found: ${routeId}`);

  // ── 2. Resolve vehicle ───────────────────────────────────────────────────
  const vehicle = store.vehicles?.[route.vehicleId];
  if (!vehicle) throw new Error(`Vehicle not found for route: ${route.vehicleId}`);

  // ── 3. Resolve driver (optional — may be unassigned) ─────────────────────
  const driver = route.driverId ? (store.drivers?.[route.driverId] || null) : null;

  // ── 4. Score the route ───────────────────────────────────────────────────
  const scoring = scoreRoute(route, vehicle, driver, store);

  // ── 5. Determine decision ─────────────────────────────────────────────────
  const decision = _resolveDecision(scoring);

  // ── 6. Identify blocking findings ─────────────────────────────────────────
  const blockers  = scoring.findings.filter(f =>
    f.severity === RISK_LEVEL.CRITICAL || f.severity === RISK_LEVEL.HIGH
  );
  const warnings  = scoring.findings.filter(f =>
    f.severity === RISK_LEVEL.MEDIUM || f.severity === RISK_LEVEL.LOW
  );
  const legalRefs = scoring.findings.filter(f => f.legal && f.reference);

  // ── 7. Build SafetyDecision ───────────────────────────────────────────────
  const safetyDecisionId = crypto.randomUUID();
  const safetyDecision   = {
    id:           safetyDecisionId,
    routeId,
    fleetId:      route.fleetId,
    vehicleId:    route.vehicleId,
    driverId:     route.driverId || null,

    // Core outcome
    decision:     decision,
    approved:     decision === DECISION.APPROVED || decision === DECISION.APPROVED_WITH_WARNINGS,

    // Risk scoring
    riskScore:    scoring.score,
    riskLevel:    scoring.level,
    riskBreakdown:scoring.breakdown,

    // Findings
    findings:     scoring.findings,
    blockers:     blockers.map(f => f.message),
    warnings:     warnings.map(f => f.message),
    legalRefs:    legalRefs.map(f => ({ rule: f.ruleId, reference: f.reference, message: f.message })),

    // Metadata
    evaluatedAt:  Date.now(),
    evaluatedBy:  "ap3x-safety-engine-v1",
    requestedBy:  options.requestedBy || null,
    notes:        options.notes       || null,

    // Summary
    summary: _buildSummary(decision, scoring, blockers, warnings)
  };

  // ── 8. Persist to SSOT (safety decisions are immutable once written) ──────
  if (!store.safetyDecisions) store.safetyDecisions = {};
  store.safetyDecisions[safetyDecisionId] = safetyDecision;

  // ── 9. Tag the route with latest safety decision reference ────────────────
  // NOTE: We only add a reference pointer — we never modify route content.
  if (!store.routes[routeId].safetyDecisionIds) {
    store.routes[routeId].safetyDecisionIds = [];
  }
  store.routes[routeId].safetyDecisionIds.push(safetyDecisionId);
  store.routes[routeId].latestSafetyDecision = safetyDecisionId;
  store.routes[routeId].safetyApproved       = safetyDecision.approved;

  // ── 10. Emit event ───────────────────────────────────────────────────────
  const eventType = decision === DECISION.APPROVED
    ? "safety.route.approved"
    : decision === DECISION.APPROVED_WITH_WARNINGS
    ? "safety.route.approved_with_warnings"
    : "safety.route.rejected";

  emitEvent(store, {
    type:     eventType,
    fleetId:  route.fleetId,
    entityId: safetyDecisionId,
    collection:"safetyDecisions",
    payload: {
      safetyDecisionId,
      routeId,
      decision,
      riskScore: scoring.score,
      riskLevel: scoring.level,
      blockerCount: blockers.length,
      warningCount: warnings.length
    }
  });

  return safetyDecision;
}

// ─── BATCH EVALUATION ────────────────────────────────────────────────────────

/**
 * Evaluate all pending routes for a fleet.
 * Returns array of SafetyDecision objects.
 */
export function evaluateFleetRoutes(store, fleetId) {
  const routes = Object.values(store.routes || {})
    .filter(r => r.fleetId === fleetId && r.status !== "cancelled");

  return routes.map(r => {
    try {
      return evaluateRoute(store, r.id);
    } catch (err) {
      return {
        routeId:   r.id,
        decision:  DECISION.REJECTED,
        approved:  false,
        error:     err.message,
        evaluatedAt: Date.now()
      };
    }
  });
}

// ─── LOOKUP ──────────────────────────────────────────────────────────────────

export function getSafetyDecision(store, decisionId) {
  const d = store.safetyDecisions?.[decisionId];
  if (!d) throw new Error(`Safety decision not found: ${decisionId}`);
  return d;
}

export function getRouteDecisions(store, routeId) {
  return Object.values(store.safetyDecisions || {})
    .filter(d => d.routeId === routeId)
    .sort((a, b) => b.evaluatedAt - a.evaluatedAt);
}

export function listSafetyDecisions(store, fleetId) {
  const all = Object.values(store.safetyDecisions || {});
  return fleetId ? all.filter(d => d.fleetId === fleetId) : all;
}

// ─── GATE CHECK (used by routing engine before dispatch) ──────────────────────

/**
 * Hard gate: returns true only if the route has a current APPROVED safety decision.
 * This is what the routing dispatch layer calls before allowing execution.
 */
export function isRouteApproved(store, routeId) {
  const route = store.routes?.[routeId];
  if (!route) return false;
  if (!route.latestSafetyDecision) return false;

  const decision = store.safetyDecisions?.[route.latestSafetyDecision];
  if (!decision) return false;

  // Decision must be recent (within 30 minutes — stale approvals require re-evaluation)
  const APPROVAL_TTL_MS = 30 * 60 * 1000;
  const isStale = Date.now() - decision.evaluatedAt > APPROVAL_TTL_MS;

  return decision.approved && !isStale;
}

// ─── INTERNAL ────────────────────────────────────────────────────────────────

function _resolveDecision(scoring) {
  // Critical findings = immediate rejection regardless of total score
  const hasCritical = scoring.findings.some(f => f.severity === RISK_LEVEL.CRITICAL);
  if (hasCritical) return DECISION.REJECTED;

  // Score-based band
  if (scoring.score >= RISK_BANDS.HIGH.min)   return DECISION.REJECTED;
  if (scoring.score >= RISK_BANDS.MEDIUM.min) return DECISION.APPROVED_WITH_WARNINGS;
  return DECISION.APPROVED;
}

function _buildSummary(decision, scoring, blockers, warnings) {
  const icon = {
    [DECISION.APPROVED]:               "✓",
    [DECISION.APPROVED_WITH_WARNINGS]: "⚠",
    [DECISION.REJECTED]:               "✗"
  }[decision] || "?";

  const lines = [`${icon} ${decision.toUpperCase()} — Risk Score: ${scoring.score}/100 (${scoring.level})`];

  if (blockers.length) {
    lines.push(`${blockers.length} blocker${blockers.length > 1 ? "s" : ""}:`);
    blockers.forEach(b => lines.push(`  • ${b}`));
  }
  if (warnings.length) {
    lines.push(`${warnings.length} warning${warnings.length > 1 ? "s" : ""}:`);
    warnings.slice(0, 3).forEach(w => lines.push(`  · ${w}`));
    if (warnings.length > 3) lines.push(`  · ...and ${warnings.length - 3} more`);
  }

  return lines.join("\n");
}
