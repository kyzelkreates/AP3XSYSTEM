// AP3X Environment Adapter
// Translates a validated bundle into target-specific deploy instructions.
// Supports: Vercel, Server (Node.js/VPS), Edge (Cloudflare Workers / Vercel Edge).
// IMPORTANT: This module produces deploy manifests and instructions.
// Actual HTTP calls to Vercel/CF APIs happen in the orchestrator which holds secrets.
// This keeps the adapter pure and testable without credentials.

import { DEPLOY_ENV, BUNDLE_TARGET, BUNDLE_SECTION } from "./deployment-constants.js";

// ─── ADAPT BUNDLE ─────────────────────────────────────────────────────────────

/**
 * Convert a validated bundle into a target-specific deploy plan.
 *
 * @param {object} bundle   - from build-packager
 * @param {string} env      - DEPLOY_ENV.*
 * @param {object} options
 *   projectName:  string   Vercel project name or server hostname
 *   region:       string   Vercel region / CF zone
 *   apiKey:       string   (kept opaque — never logged)
 *   teamId:       string   Vercel team ID (optional)
 * @returns {DeployPlan}
 */
export function adaptBundle(bundle, env, options = {}) {
  switch (env) {
    case DEPLOY_ENV.VERCEL: return _adaptVercel(bundle, options);
    case DEPLOY_ENV.SERVER: return _adaptServer(bundle, options);
    case DEPLOY_ENV.EDGE:   return _adaptEdge(bundle, options);
    case DEPLOY_ENV.LOCAL:  return _adaptLocal(bundle, options);
    default: throw new Error(`Unknown deploy environment: ${env}`);
  }
}

// ─── VERCEL ADAPTER ───────────────────────────────────────────────────────────

function _adaptVercel(bundle, options) {
  const { sections, fleetId, version, bundleId: bId, target } = bundle;
  const manifest = sections[BUNDLE_SECTION.MANIFEST];
  const config   = sections[BUNDLE_SECTION.CONFIG];
  const brand    = sections[BUNDLE_SECTION.BRANDING];
  const envVars  = sections[BUNDLE_SECTION.ENV_VARS] || {};

  // Build Vercel env var payload
  const vercelEnv = _toVercelEnv({
    AP3X_FLEET_ID:          fleetId,
    AP3X_FLEET_VERSION:     version,
    AP3X_BUNDLE_ID:         bId,
    AP3X_BUNDLE_TARGET:     target,
    AP3X_REGULATION:        config?.regulation || "",
    AP3X_BRAND_PRIMARY:     brand?.primaryColor || "#7C3AED",
    AP3X_BRAND_SECONDARY:   brand?.secondaryColor || "#1E1E2E",
    AP3X_BUNDLE_CHECKSUM:   manifest?.checksum || "",
    AP3X_DEPLOYED_AT:       String(Date.now()),
    ...envVars
  });

  // Vercel deployment file list — static JSON data files for the fleet
  const files = _buildVercelFiles(bundle);

  return {
    env:         DEPLOY_ENV.VERCEL,
    projectName: options.projectName || "ap3x-master-controller",
    teamId:      options.teamId      || null,
    region:      options.region      || "lhr1",
    target:      options.target      || "production",
    envVars:     vercelEnv,
    files,

    // Vercel API call spec — orchestrator executes this
    apiSpec: {
      method:   "POST",
      endpoint: "https://api.vercel.com/v13/deployments",
      headers:  {
        "Content-Type":  "application/json",
        // Authorization header filled by orchestrator with actual token
      },
      body: {
        name:            options.projectName || "ap3x-master-controller",
        target:          options.target      || "production",
        regions:         [options.region     || "lhr1"],
        files,
        env:             vercelEnv,
        meta: {
          ap3xFleetId:   fleetId,
          ap3xVersion:   version,
          ap3xBundleId:  bId,
          ap3xChecksum:  manifest?.checksum || ""
        }
      }
    },

    // Health check endpoint — polled post-deploy
    healthEndpoint: `https://${options.projectName || "ap3x"}.vercel.app/api/obs/query?mode=fleet-activity&fleetId=${fleetId}&sinceMs=${Date.now() - 60000}`,
    bundleChecksum: manifest?.checksum || null,
    generatedAt:    Date.now()
  };
}

// ─── SERVER ADAPTER ───────────────────────────────────────────────────────────

function _adaptServer(bundle, options) {
  const { sections, fleetId, version, bundleId: bId } = bundle;
  const manifest = sections[BUNDLE_SECTION.MANIFEST];
  const envVars  = sections[BUNDLE_SECTION.ENV_VARS] || {};

  // Generate an env file + fleet data JSON for rsync / scp deployment
  const envFile = _toEnvFile({
    AP3X_FLEET_ID:      fleetId,
    AP3X_FLEET_VERSION: version,
    AP3X_BUNDLE_ID:     bId,
    AP3X_BUNDLE_TARGET: bundle.target,
    AP3X_REGULATION:    sections[BUNDLE_SECTION.CONFIG]?.regulation || "",
    AP3X_DEPLOYED_AT:   String(Date.now()),
    ...envVars
  });

  const fleetDataJson = JSON.stringify(_buildFleetDataPayload(bundle), null, 2);

  return {
    env:         DEPLOY_ENV.SERVER,
    hostname:    options.projectName || options.hostname || "ap3x-server",
    port:        options.port        || 3000,
    deployPath:  options.deployPath  || "/opt/ap3x",

    // Files to transfer
    artifacts: [
      { filename: ".env.ap3x",          content: envFile,       mode: "600" },
      { filename: "fleet-data.json",     content: fleetDataJson, mode: "644" },
      { filename: "ap3x-version.json",   content: JSON.stringify({ version, bundleId: bId, deployedAt: Date.now() }), mode: "644" }
    ],

    // Shell commands the orchestrator runs post-transfer
    postDeployCommands: [
      "pm2 reload ap3x --update-env",
      "sleep 3",
      "pm2 status ap3x"
    ],

    healthEndpoint:  `http://${options.projectName || "localhost"}:${options.port || 3000}/api/obs/query?mode=fleet-activity&fleetId=${fleetId}&sinceMs=${Date.now() - 60000}`,
    bundleChecksum:  manifest?.checksum || null,
    generatedAt:     Date.now()
  };
}

// ─── EDGE ADAPTER (Cloudflare Workers / Vercel Edge) ──────────────────────────

function _adaptEdge(bundle, options) {
  const { sections, fleetId, version, bundleId: bId } = bundle;
  const manifest = sections[BUNDLE_SECTION.MANIFEST];
  const envVars  = sections[BUNDLE_SECTION.ENV_VARS] || {};

  // Edge: fleet config + branding injected as KV bindings or env vars
  const bindings = {
    AP3X_FLEET_ID:      fleetId,
    AP3X_FLEET_VERSION: version,
    AP3X_BUNDLE_ID:     bId,
    AP3X_BUNDLE_TARGET: bundle.target,
    AP3X_REGULATION:    sections[BUNDLE_SECTION.CONFIG]?.regulation || "",
    AP3X_DEPLOYED_AT:   String(Date.now()),
    ...envVars
  };

  // Wrangler-compatible KV namespace entries
  const kvEntries = _buildKvEntries(bundle);

  return {
    env:             DEPLOY_ENV.EDGE,
    zone:            options.zone        || null,
    workerName:      options.projectName || "ap3x-edge",
    bindings,
    kvEntries,

    // wrangler deploy command spec
    wranglerSpec: {
      command:  "wrangler deploy",
      flags:    ["--env", options.stage || "production"],
      vars:     bindings
    },

    healthEndpoint:  options.healthEndpoint || null,
    bundleChecksum:  manifest?.checksum || null,
    generatedAt:     Date.now()
  };
}

// ─── LOCAL (DRY-RUN) ADAPTER ──────────────────────────────────────────────────

function _adaptLocal(bundle, options) {
  const { sections, fleetId, version, bundleId: bId } = bundle;
  const manifest = sections[BUNDLE_SECTION.MANIFEST];

  return {
    env:            DEPLOY_ENV.LOCAL,
    dryRun:         true,
    outputPath:     options.outputPath || "./dist/ap3x-bundle",
    fleetId,
    version,
    bundleId:       bId,
    sections:       Object.keys(sections),
    bundleChecksum: manifest?.checksum || null,
    sizeBytes:      bundle.sizeEstimateBytes,
    generatedAt:    Date.now(),
    note:           "Local dry-run. No remote calls made."
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _toVercelEnv(vars) {
  return Object.entries(vars).map(([key, value]) => ({
    key, value: String(value), type: "plain", target: ["production", "preview"]
  }));
}

function _toEnvFile(vars) {
  return Object.entries(vars)
    .map(([k, v]) => `${k}="${v}"`)
    .join("\n") + "\n";
}

function _buildVercelFiles(bundle) {
  const files = [];
  const { sections, fleetId, version } = bundle;

  // Fleet data as static JSON served by the API
  files.push({
    file:     `data/fleets/${fleetId}.json`,
    encoding: "utf-8",
    data:     JSON.stringify(_buildFleetDataPayload(bundle), null, 2)
  });

  // Version manifest
  files.push({
    file:     `data/versions/${fleetId}-latest.json`,
    encoding: "utf-8",
    data:     JSON.stringify({
      version,
      bundleId:  bundle.id,
      target:    bundle.target,
      checksum:  sections[BUNDLE_SECTION.MANIFEST]?.checksum,
      createdAt: bundle.createdAt
    }, null, 2)
  });

  return files;
}

function _buildFleetDataPayload(bundle) {
  const { sections, fleetId, version } = bundle;
  return {
    fleetId,
    version,
    config:    sections[BUNDLE_SECTION.CONFIG]   || {},
    branding:  sections[BUNDLE_SECTION.BRANDING] || {},
    drivers:   sections[BUNDLE_SECTION.DRIVERS]?.records   || [],
    vehicles:  sections[BUNDLE_SECTION.VEHICLES]?.records  || [],
    devices:   sections[BUNDLE_SECTION.DEVICES]?.records   || []
  };
}

function _buildKvEntries(bundle) {
  const { sections, fleetId, version } = bundle;
  return [
    { key: `fleet:${fleetId}:config`,    value: JSON.stringify(sections[BUNDLE_SECTION.CONFIG]   || {}) },
    { key: `fleet:${fleetId}:branding`,  value: JSON.stringify(sections[BUNDLE_SECTION.BRANDING] || {}) },
    { key: `fleet:${fleetId}:drivers`,   value: JSON.stringify(sections[BUNDLE_SECTION.DRIVERS]?.records  || []) },
    { key: `fleet:${fleetId}:vehicles`,  value: JSON.stringify(sections[BUNDLE_SECTION.VEHICLES]?.records || []) },
    { key: `fleet:${fleetId}:version`,   value: version }
  ];
}
