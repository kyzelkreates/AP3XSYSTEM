// AP3X API — GET /api/deployment/status
// Returns the status of a specific deployment or the active deployment for a fleet.
//
// Query:
//   deploymentId: string  (specific deployment)
//   fleetId:      string  (active deployment for fleet)

import { getDeploymentStatus, listDeployments } from "../../core/deployment-orchestrator.js";
import { getActiveDeployment }                  from "../../core/deployment/version-manager.js";
import store                                    from "../../core/storage.js";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { deploymentId, fleetId } = req.query || {};

  try {
    if (deploymentId) {
      const dep = getDeploymentStatus(store, deploymentId);
      const bundle = dep.bundleId ? store.bundles?.[dep.bundleId] : null;
      return res.status(200).json({
        deployment: dep,
        bundle: bundle ? {
          id:                bundle.id,
          target:            bundle.target,
          checksum:          bundle.checksum,
          sizeEstimateBytes: bundle.sizeEstimateBytes,
          sections:          Object.keys(bundle.sections || {})
        } : null
      });
    }

    if (fleetId) {
      const active = getActiveDeployment(store, fleetId);
      const recent = listDeployments(store, fleetId).slice(0, 5);
      return res.status(200).json({ active, recent });
    }

    return res.status(400).json({ error: "deploymentId or fleetId required" });
  } catch (err) {
    return res.status(err.message.includes("not found") ? 404 : 500)
              .json({ error: err.message });
  }
}
