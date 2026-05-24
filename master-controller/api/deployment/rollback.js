// AP3X API — POST /api/deployment/rollback
// Rolls back a fleet to a prior stable deployment.
// RULE: Only Master Controller may initiate rollback.
//
// Body:
//   fleetId:      string   required
//   initiator:    string   must be "master_controller"
//   strategy:     string   "immediate" | "graceful" | "canary_abort"  (default: immediate)
//   targetId:     string   specific deployment ID to roll back to (optional)
//   reason:       string   audit note

import { rollbackFleet }                from "../../core/deployment-orchestrator.js";
import { isGracefulRollbackReady,
         completeGracefulRollback }     from "../../core/deployment/rollback-manager.js";
import { getRollbackCandidates }        from "../../core/deployment/version-manager.js";
import store                            from "../../core/storage.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { fleetId, initiator, strategy, targetId, reason } = req.body || {};

  if (initiator !== "master_controller") {
    return res.status(403).json({
      error:  "AP3X ROLLBACK RULE VIOLATION",
      detail: "Only the Master Controller may roll back deployments.",
      code:   "INITIATOR_NOT_MASTER_CONTROLLER"
    });
  }

  if (!fleetId) return res.status(400).json({ error: "fleetId required" });

  // Special case: complete a pending graceful rollback
  if (req.body.completePending) {
    if (!isGracefulRollbackReady(store, fleetId)) {
      return res.status(409).json({
        error: "Graceful rollback not yet ready — active driver sessions or routes still open"
      });
    }
    const result = completeGracefulRollback(store, fleetId);
    return res.status(200).json(result);
  }

  try {
    const result = rollbackFleet(store, fleetId, {
      initiator: "master_controller",
      strategy:  strategy || "immediate",
      targetId,
      reason:    reason   || "Manual rollback via API"
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API] deployment/rollback error:", err.message);
    return res.status(err.message.includes("VIOLATION") ? 403 : 500)
              .json({ error: err.message });
  }
}
