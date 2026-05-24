// AP3X API — POST /api/deployment/preflight
// Run pre-flight checks for a fleet without starting a deployment.
// Useful for validating readiness before committing to a deploy.
//
// Body: { fleetId: string }

import { runPreFlight } from "../../core/deployment-orchestrator.js";
import store            from "../../core/storage.js";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { fleetId } = req.body || {};
  if (!fleetId) return res.status(400).json({ error: "fleetId required" });

  try {
    const result = runPreFlight(store, fleetId);
    return res.status(result.passed ? 200 : 422).json({
      fleetId,
      passed:   result.passed,
      failures: result.failures,
      warnings: result.warnings,
      checks:   result.checks
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
