// AP3X API — POST /api/deployFleet
// Triggers a full fleet deployment pipeline via the Master Controller.
// RULE: Only Master Controller may deploy. Caller must pass initiator: "master_controller".
//
// Body:
//   fleetId:      string   required
//   initiator:    string   must be "master_controller"
//   env:          string   "vercel" | "server" | "edge" | "local"  (default: vercel)
//   bundleTarget: string   "full" | "incremental" | "config_only" | "pwa_only"
//   bump:         string   "major" | "minor" | "patch"  (default: patch)
//   version:      string   override version string (optional)
//   changelog:    string[] change notes
//   envVars:      object   non-secret env vars for target adapter
//   projectName:  string   Vercel project name / server hostname
//   teamId:       string   Vercel team ID (optional)
//   region:       string   deploy region (default: lhr1)
//   dryRun:       bool     full pipeline, no remote calls

import {
  deployFleet,
  runPreFlight,
  getDeploymentStatus,
  listDeployments
} from "../core/deployment-orchestrator.js";
import store from "../core/storage.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    fleetId, initiator, env, bundleTarget, bump,
    version, changelog, envVars, projectName, teamId,
    region, dryRun
  } = req.body || {};

  // ── Guard: initiator must declare itself ──────────────────────────────────
  if (initiator !== "master_controller") {
    return res.status(403).json({
      error:  "AP3X DEPLOY RULE VIOLATION",
      detail: "Only the Master Controller may deploy fleets. Fleet OS cannot self-deploy.",
      code:   "INITIATOR_NOT_MASTER_CONTROLLER"
    });
  }

  if (!fleetId) return res.status(400).json({ error: "fleetId required" });

  try {
    const result = deployFleet(store, fleetId, {
      initiator:    "master_controller",
      env:          env          || "vercel",
      bundleTarget: bundleTarget || "full",
      bump:         bump         || "patch",
      version,
      changelog:    changelog    || [],
      envVars:      envVars      || {},
      projectName:  projectName  || process.env.VERCEL_PROJECT_NAME || "ap3x-master-controller",
      teamId:       teamId       || process.env.VERCEL_TEAM_ID       || null,
      region:       region       || process.env.VERCEL_REGION        || "lhr1",
      dryRun:       !!dryRun
    });

    // If a Vercel deploy plan was produced and we have a token, execute it
    if (result.success && !dryRun && env !== "local" && result.plan?.apiSpec) {
      await _executeVercelDeploy(result.plan, result);
    }

    return res.status(result.success ? 200 : 422).json(result);

  } catch (err) {
    console.error("[API] deployFleet error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── VERCEL API CALL ──────────────────────────────────────────────────────────

async function _executeVercelDeploy(plan, result) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    result.warnings = result.warnings || [];
    result.warnings.push("VERCEL_TOKEN not set — deploy plan generated but remote call skipped");
    return;
  }

  try {
    const spec      = plan.apiSpec;
    const teamQuery = plan.teamId ? `?teamId=${plan.teamId}` : "";
    const resp      = await fetch(`${spec.endpoint}${teamQuery}`, {
      method:  spec.method,
      headers: { ...spec.headers, Authorization: `Bearer ${token}` },
      body:    JSON.stringify(spec.body)
    });

    const data = await resp.json().catch(() => ({}));

    result.vercelDeployment = {
      id:  data.id     || null,
      url: data.url    || null,
      state: data.readyState || "UNKNOWN",
      httpStatus: resp.status
    };

    if (!resp.ok) {
      result.warnings = result.warnings || [];
      result.warnings.push(`Vercel API returned ${resp.status}: ${data.error?.message || "unknown"}`);
    }
  } catch (err) {
    result.warnings = result.warnings || [];
    result.warnings.push(`Vercel API call failed: ${err.message}`);
  }
}
