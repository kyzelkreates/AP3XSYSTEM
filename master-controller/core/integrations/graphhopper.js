// AP3X GraphHopper Integration — RUN 4 STUB
// Primary routing provider. This is a well-structured stub:
// - Correct request/response shape for real GH Routing API v1
// - Vehicle constraint params wired up
// - Ready to activate by swapping GRAPHHOPPER_API_KEY env var
//
// GH API docs: https://docs.graphhopper.com/#operation/postRoute
// RUN 4 live activation: replace stub response with real fetch() call.

import { buildConstraintSnapshot } from "../routing/vehicle-constraints.js";

const GH_API_BASE = "https://graphhopper.com/api/1";

// ─── VEHICLE PROFILE MAP ──────────────────────────────────────────────────────
// Maps AP3X weight class → GH vehicle profile
const GH_PROFILE_MAP = {
  light:       "car",
  medium:      "small_truck",
  heavy:       "truck",
  articulated: "truck"
};

// ─── MAIN STUB ────────────────────────────────────────────────────────────────

/**
 * GraphHopper routing stub.
 * Returns a realistic route response shape — no live API call in RUN 4.
 *
 * @param {object}   vehicle  - AP3X vehicle object
 * @param {object[]} drops    - ordered drop points [{lat, lon, label}]
 * @param {object}   options  - { constraintProfile?, departureTime?, optimise? }
 * @returns {Promise<object>} - Provider result in AP3X format
 */
export async function graphHopperStub(vehicle, drops, options = {}) {
  // ── Build the GH request shape (for logging / live swap) ─────────────────
  const profile   = GH_PROFILE_MAP[vehicle.weightClass] || "small_truck";
  const points    = drops.map(d => [d.lon, d.lat]); // GH uses [lon, lat] order
  const apiKey    = (typeof process !== "undefined" && process.env?.GRAPHHOPPER_API_KEY) || null;

  const ghRequest = {
    profile,
    points,
    points_encoded: false,
    instructions:   true,
    calc_points:    true,
    vehicle_height: vehicle.height || 3.5,
    vehicle_width:  vehicle.width  || 2.4,
    vehicle_weight: _weightClassToTonnes(vehicle.weightClass),
    locale: "en",
    ...(options.departureTime ? { departure_time: new Date(options.departureTime).toISOString() } : {})
  };

  // ── If API key present, perform live call (stub defers to simulation) ─────
  if (apiKey) {
    return await _liveGraphHopperCall(ghRequest, apiKey, vehicle, drops, options);
  }

  // ── Stub simulation ───────────────────────────────────────────────────────
  console.info("[AP3X] GraphHopper: running in STUB mode (no API key). Set GRAPHHOPPER_API_KEY to go live.");

  const constraintsSnapshot = buildConstraintSnapshot(vehicle, options.constraintProfile || "standard");
  const simulatedLegs       = _simulateLegs(drops);

  return {
    provider:            "graphhopper",
    mode:                "stub",
    requestShape:        ghRequest,       // logged for live debugging
    legs:                simulatedLegs,
    constraintsSnapshot,
    meta: {
      profile,
      pointCount: drops.length,
      ghApiReady: !!apiKey
    }
  };
}

// ─── LIVE CALL (activates when GRAPHHOPPER_API_KEY is set) ───────────────────

async function _liveGraphHopperCall(ghRequest, apiKey, vehicle, drops, options) {
  const url  = `${GH_API_BASE}/route?key=${apiKey}`;
  const resp = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(ghRequest)
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`GraphHopper API error ${resp.status}: ${body}`);
  }

  const ghData = await resp.json();
  const path   = ghData.paths?.[0];
  if (!path) throw new Error("GraphHopper returned no paths");

  // Translate GH response → AP3X provider result shape
  const constraintsSnapshot = buildConstraintSnapshot(vehicle, options.constraintProfile || "standard");

  const legs = (path.instructions || [])
    .filter(ins => ins.distance > 0)
    .map((ins, i) => ({
      from:         drops[i]     || {},
      to:           drops[i + 1] || {},
      distanceKm:   parseFloat((ins.distance / 1000).toFixed(2)),
      durationMin:  parseFloat((ins.time / 60000).toFixed(1)),
      instructions: [ins.text || ""]
    }));

  return {
    provider:            "graphhopper",
    mode:                "live",
    legs,
    constraintsSnapshot,
    raw: {
      distanceM:   path.distance,
      durationMs:  path.time,
      ascend:      path.ascend,
      descend:     path.descend
    },
    meta: {
      profile:    ghRequest.profile,
      pointCount: drops.length,
      ghApiReady: true
    }
  };
}

// ─── STUB HELPERS ─────────────────────────────────────────────────────────────

function _simulateLegs(drops) {
  const AVG_SPEED_KMH = 48; // conservative urban/mixed
  const legs = [];

  for (let i = 0; i < drops.length - 1; i++) {
    const from = drops[i];
    const to   = drops[i + 1];
    const km   = _haversineKm(from.lat, from.lon, to.lat, to.lon);
    // Add 15% routing overhead vs straight-line (realistic roads factor)
    const routedKm  = parseFloat((km * 1.15).toFixed(2));
    const durMin    = parseFloat(((routedKm / AVG_SPEED_KMH) * 60).toFixed(1));

    legs.push({
      from:         { lat: from.lat, lon: from.lon, label: from.label || `Stop ${i + 1}` },
      to:           { lat: to.lat,   lon: to.lon,   label: to.label   || `Stop ${i + 2}` },
      distanceKm:   routedKm,
      durationMin:  durMin,
      instructions: [
        `Depart ${from.label || "stop"}`,
        `Head towards ${to.label || "next stop"} (~${routedKm}km, ~${durMin}min)`
      ]
    });
  }
  return legs;
}

function _weightClassToTonnes(weightClass) {
  const map = { light: 3500, medium: 12000, heavy: 26000, articulated: 40000 };
  return map[weightClass] || 12000; // kg for GH API
}

function _haversineKm(lat1, lon1, lat2, lon2) {
  const R  = 6371;
  const dL = _toRad(lat2 - lat1);
  const dG = _toRad(lon2 - lon1);
  const a  = Math.sin(dL / 2) ** 2
            + Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function _toRad(deg) { return deg * Math.PI / 180; }
