// AP3X API — GET /api/deployment/list
// Returns deployment history for a fleet with optional filtering.
//
// Query:
//   fleetId:  string   required
//   status:   string   filter by status (optional)
//   limit:    number   max records (default: 20)

import { listDeployments, getRollbackCandidates } from "../../core/deployment-orchestrator.js";
import { getActiveDeployment }                    from "../../core/deployment/version-manager.js";
import store                                      from "../../core/storage.js";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { fleetId, status, limit } = req.query || {};
  if (!fleetId) return res.status(400).json({ error: "fleetId required" });

  const maxLimit = Math.min(parseInt(limit) || 20, 100);

  let deployments = listDeployments(store, fleetId);
  if (status) deployments = deployments.filter(d => d.status === status);
  deployments = deployments.slice(0, maxLimit);

  const active     = getActiveDeployment(store, fleetId);
  const candidates = getRollbackCandidates(store, fleetId, 5);

  return res.status(200).json({
    fleetId,
    total:              deployments.length,
    active,
    rollbackCandidates: candidates,
    deployments
  });
}
