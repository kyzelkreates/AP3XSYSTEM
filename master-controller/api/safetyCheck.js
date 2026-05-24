// AP3X Safety Check API — RUN 5
// POST /api/safetyCheck
// Evaluates a route through the Safety AI Gatekeeper and returns a SafetyDecision.
// READ-ONLY from routing perspective — only writes safetyDecisions to SSOT.

import { evaluateRoute, evaluateFleetRoutes, getRouteDecisions, isRouteApproved } from "../core/safety/safety-engine.js";
import store from "../core/storage.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, routeId, fleetId, requestedBy, notes } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: "action is required: evaluate | evaluate_fleet | get_decisions | is_approved" });
  }

  try {
    switch (action) {

      // ── Evaluate a single route ──────────────────────────────────────────
      case "evaluate": {
        if (!routeId) return res.status(400).json({ error: "routeId is required for action=evaluate" });
        const decision = evaluateRoute(store, routeId, { requestedBy, notes });
        return res.status(200).json({
          success:  true,
          action:   "evaluate",
          decision
        });
      }

      // ── Evaluate all routes for a fleet ──────────────────────────────────
      case "evaluate_fleet": {
        if (!fleetId) return res.status(400).json({ error: "fleetId is required for action=evaluate_fleet" });
        const decisions = evaluateFleetRoutes(store, fleetId);
        return res.status(200).json({
          success:   true,
          action:    "evaluate_fleet",
          fleetId,
          count:     decisions.length,
          decisions
        });
      }

      // ── Get all decisions for a route ─────────────────────────────────────
      case "get_decisions": {
        if (!routeId) return res.status(400).json({ error: "routeId is required for action=get_decisions" });
        const decisions = getRouteDecisions(store, routeId);
        return res.status(200).json({
          success:   true,
          action:    "get_decisions",
          routeId,
          count:     decisions.length,
          decisions
        });
      }

      // ── Hard gate check (pre-dispatch) ────────────────────────────────────
      case "is_approved": {
        if (!routeId) return res.status(400).json({ error: "routeId is required for action=is_approved" });
        const approved = isRouteApproved(store, routeId);
        return res.status(200).json({
          success:  true,
          action:   "is_approved",
          routeId,
          approved,
          // If not approved, tell the caller why so they can surface it
          reason:   approved ? null : _getNotApprovedReason(store, routeId)
        });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _getNotApprovedReason(store, routeId) {
  const route = store.routes?.[routeId];
  if (!route) return "Route not found";
  if (!route.latestSafetyDecision) return "No safety evaluation performed — call action=evaluate first";

  const decision = store.safetyDecisions?.[route.latestSafetyDecision];
  if (!decision) return "Safety decision record missing";

  const APPROVAL_TTL_MS = 30 * 60 * 1000;
  const isStale = Date.now() - decision.evaluatedAt > APPROVAL_TTL_MS;
  if (isStale) return "Safety approval has expired (>30 minutes) — re-evaluate before dispatch";
  if (!decision.approved) return `Route rejected: risk score ${decision.riskScore}/100 — ${decision.blockers?.[0] || "see full decision"}`;

  return "Unknown reason";
}
