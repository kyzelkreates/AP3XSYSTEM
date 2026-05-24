// AP3X OSM Fallback — RUN 4
// Secondary routing provider. Used when GraphHopper is unavailable.
// Uses OSRM (Open Source Routing Machine) public API — no key required.
// Fallback chain: GraphHopper → OSRM/OSM → Error
//
// OSRM docs: http://project-osrm.org/docs/v5.24.0/api/
// Public OSRM endpoint (rate-limited, for production use self-hosted instance):
//   https://router.project-osrm.org

import { buildConstraintSnapshot } from "../routing/vehicle-constraints.js";

const OSRM_BASE = "https://router.project-osrm.org";

// OSRM profile map — limited vs GH but sufficient for fallback
const OSRM_PROFILE_MAP = {
  light:       "car",
  medium:      "car",   // OSRM public doesn't have truck profile — self-hosted does
  heavy:       "car",
  articulated: "car"
};

// ─── MAIN FALLBACK ────────────────────────────────────────────────────────────

/**
 * OSM/OSRM fallback routing.
 * Attempts live OSRM call first, then degrades to haversine simulation.
 *
 * @param {object}   vehicle
 * @param {object[]} drops    - ordered [{lat, lon, label}]
 * @param {object}   options
 * @returns {Promise<object>} - Provider result in AP3X format
 */
export async function osmFallback(vehicle, drops, options = {}) {
  const constraintsSnapshot = buildConstraintSnapshot(vehicle, options.constraintProfile || "standard");

  // ── Attempt live OSRM ─────────────────────────────────────────────────────
  try {
    const result = await _liveOSRMCall(vehicle, drops, options);
    return { ...result, constraintsSnapshot };
  } catch (osrmErr) {
    console.warn("[AP3X] OSM/OSRM live call failed, degrading to haversine simulation:", osrmErr.message);
  }

  // ── Final degraded fallback: haversine simulation ──────────────────────────
  console.info("[AP3X] OSM Fallback: running in SIMULATION mode (haversine only — no road snapping).");

  const legs = _simulateLegsOSM(drops);

  return {
    provider:            "osm_fallback",
    mode:                "simulation",
    legs,
    constraintsSnapshot,
    warning:             "Routing computed via haversine simulation — no road topology applied. Distances are estimates only.",
    meta: {
      profile:    OSRM_PROFILE_MAP[vehicle.weightClass] || "car",
      pointCount: drops.length,
      osrmLive:   false
    }
  };
}

// ─── LIVE OSRM ────────────────────────────────────────────────────────────────

async function _liveOSRMCall(vehicle, drops, options) {
  if (drops.length < 2) throw new Error("OSRM requires at least 2 waypoints");

  const profile   = OSRM_PROFILE_MAP[vehicle.weightClass] || "car";
  // OSRM coordinate string: lon,lat;lon,lat;...
  const coordStr  = drops.map(d => `${d.lon},${d.lat}`).join(";");
  const url       = `${OSRM_BASE}/route/v1/${profile}/${coordStr}?steps=true&annotations=false&geometries=geojson&overview=false`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 8000); // 8s timeout

  let resp;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) throw new Error(`OSRM ${resp.status}: ${await resp.text().catch(() => "")}`);

  const data = await resp.json();
  if (data.code !== "Ok") throw new Error(`OSRM returned code: ${data.code}`);

  const route = data.routes?.[0];
  if (!route) throw new Error("OSRM returned no routes");

  // Map OSRM legs → AP3X leg shape
  const legs = (route.legs || []).map((leg, i) => {
    const stepTexts = (leg.steps || [])
      .filter(s => s.maneuver?.type !== "arrive" || i === route.legs.length - 1)
      .map(s => s.name ? `${s.maneuver?.type || ""} onto ${s.name}`.trim() : s.maneuver?.type || "")
      .filter(Boolean)
      .slice(0, 5); // cap at 5 steps per leg for storage

    return {
      from:         { lat: drops[i].lat,     lon: drops[i].lon,     label: drops[i].label },
      to:           { lat: drops[i+1]?.lat,  lon: drops[i+1]?.lon,  label: drops[i+1]?.label },
      distanceKm:   parseFloat((leg.distance / 1000).toFixed(2)),
      durationMin:  parseFloat((leg.duration / 60).toFixed(1)),
      instructions: stepTexts.length ? stepTexts : [`Head from ${drops[i].label || "stop"} to ${drops[i+1]?.label || "next stop"}`]
    };
  });

  return {
    provider:   "osm_fallback",
    mode:       "live_osrm",
    legs,
    meta: {
      profile,
      pointCount:     drops.length,
      osrmLive:       true,
      totalDistanceM: route.distance,
      totalDurationS: route.duration
    }
  };
}

// ─── SIMULATION FALLBACK ──────────────────────────────────────────────────────

function _simulateLegsOSM(drops) {
  const AVG_SPEED_KMH = 45; // slightly lower than GH stub — more conservative
  const legs = [];

  for (let i = 0; i < drops.length - 1; i++) {
    const from = drops[i];
    const to   = drops[i + 1];
    const km   = _haversineKm(from.lat, from.lon, to.lat, to.lon);
    // 1.2x road overhead factor for OSM sim (slightly less than GH)
    const routedKm = parseFloat((km * 1.20).toFixed(2));
    const durMin   = parseFloat(((routedKm / AVG_SPEED_KMH) * 60).toFixed(1));

    legs.push({
      from:         { lat: from.lat, lon: from.lon, label: from.label || `Stop ${i + 1}` },
      to:           { lat: to.lat,   lon: to.lon,   label: to.label   || `Stop ${i + 2}` },
      distanceKm:   routedKm,
      durationMin:  durMin,
      instructions: [
        `[OSM SIM] ${from.label || "Stop"} → ${to.label || "Next stop"} (~${routedKm}km estimated)`
      ]
    });
  }
  return legs;
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
