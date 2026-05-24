// AP3X Master Controller — API client
// All calls go through /api/* Vercel serverless functions.

const BASE = "";

async function request(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({ error: "Invalid JSON response" }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Fleet ──────────────────────────────────────────────────────────────────
export const fleetApi = {
  create: (data)           => request("POST", "/api/createFleet", data),
  update: (data)           => request("POST", "/api/updateFleet", data),
  deploy: (data)           => request("POST", "/api/deployFleet", {
    ...data, initiator: "master_controller", env: "vercel",
    bundleTarget: "full", bump: "patch"
  }),
  deploymentStatus: (id)   => request("GET",  `/api/deployment/status?deploymentId=${id}`),
  listDeployments:  (fleetId) => request("GET", `/api/deployment/list?fleetId=${fleetId}`),
  preflight: (fleetId)     => request("POST", "/api/deployment/preflight", { fleetId }),
  rollback: (fleetId, deploymentId) => request("POST", "/api/deployment/rollback", {
    fleetId, deploymentId, initiator: "master_controller"
  }),
};

// ── Driver ─────────────────────────────────────────────────────────────────
export const driverApi = {
  sync: (params) => request("GET", `/api/driver/sync?${new URLSearchParams(params)}`),
};

// ── Device ─────────────────────────────────────────────────────────────────
export const deviceApi = {
  checkin:   (data) => request("POST", "/api/device/checkin",   data),
  heartbeat: (data) => request("POST", "/api/device/heartbeat", data),
};

// ── Hazard ─────────────────────────────────────────────────────────────────
export const hazardApi = {
  report:  (data) => request("POST", "/api/hazard/report",  data),
  confirm: (data) => request("POST", "/api/hazard/confirm", data),
  dispute: (data) => request("POST", "/api/hazard/dispute", data),
};

// ── Safety ─────────────────────────────────────────────────────────────────
export const safetyApi = {
  evaluate: (routeId, requestedBy) =>
    request("POST", "/api/safetyCheck", { action: "evaluate", routeId, requestedBy }),
  isApproved: (routeId) =>
    request("POST", "/api/safetyCheck", { action: "is_approved", routeId }),
};

// ── Tacho ──────────────────────────────────────────────────────────────────
export const tachoApi = {
  activity: (data) => request("POST", "/api/tacho/activity", data),
  session:  (data) => request("POST", "/api/tacho/session",  data),
};

// ── Observability ──────────────────────────────────────────────────────────
export const obsApi = {
  query:  (params) => request("GET", `/api/obs/query?${new URLSearchParams(params)}`),
  export: (data)   => request("POST", "/api/obs/export", data),
};

// ── Nav ────────────────────────────────────────────────────────────────────
export const navApi = {
  event: (data) => request("POST", "/api/nav/event", data),
};
