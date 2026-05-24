// AP3X Route Builder — RUN 4
// Assembles the canonical route object from provider output + spec.
// This is the single shape that all downstream systems (PWA, tacho, hazards) will consume.

// ─── ROUTE OBJECT SCHEMA ────────────────────────────────────────────────────
//
// route {
//   id             string        UUID
//   fleetId        string
//   vehicleId      string
//   driverId       string|null
//   status         ROUTE_STATUS
//   provider       ROUTING_PROVIDER
//   drops          Drop[]
//   legs           Leg[]
//   summary        Summary
//   constraints    VehicleConstraints (snapshot at generation time)
//   options        object        (original caller options)
//   validation     ValidationResult
//   failureReasons string[]|null
//   createdAt      number        epoch ms
//   cancelledAt    number|null
// }
//
// Drop {
//   sequence       number
//   label          string
//   lat            number
//   lon            number
//   estimatedArrival number   epoch ms (computed by provider)
//   notes          string|null
// }
//
// Leg {
//   from           { lat, lon, label }
//   to             { lat, lon, label }
//   distanceKm     number
//   durationMin    number
//   instructions   string[]   (turn-by-turn stubs — detail from provider)
// }
//
// Summary {
//   distanceKm     number
//   durationMin    number
//   dropCount      number
//   startTime      number    epoch ms
//   endTime        number    epoch ms (estimated)
// }
//
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the canonical AP3X route object.
 * @param {object} params
 * @param {string} params.fleetId
 * @param {string} params.vehicleId
 * @param {string|null} params.driverId
 * @param {object[]} params.drops          - ordered drop points
 * @param {string} params.provider
 * @param {object} params.providerResult   - raw output from GH stub / OSM fallback
 * @param {object} params.options
 */
export function buildRouteObject({ fleetId, vehicleId, driverId, drops, provider, providerResult, options }) {
  const routeId  = crypto.randomUUID();
  const now      = Date.now();
  const startTime = options.departureTime || now;

  // Build legs from provider result
  const legs = buildLegs(drops, providerResult, startTime);

  // Build enriched drops with estimated arrivals
  const enrichedDrops = enrichDrops(drops, legs, startTime);

  // Summarise
  const totalDistanceKm  = legs.reduce((s, l) => s + l.distanceKm, 0);
  const totalDurationMin = legs.reduce((s, l) => s + l.durationMin, 0);

  return {
    id:           routeId,
    fleetId,
    vehicleId,
    driverId:     driverId || null,
    status:       "computed",
    provider,
    drops:        enrichedDrops,
    legs,
    summary: {
      distanceKm:  parseFloat(totalDistanceKm.toFixed(2)),
      durationMin: parseFloat(totalDurationMin.toFixed(1)),
      dropCount:   drops.length,
      startTime,
      endTime:     startTime + totalDurationMin * 60 * 1000
    },
    constraints:  providerResult.constraintsSnapshot || null,
    options,
    validation:   null,     // filled by validator
    failureReasons: null,
    createdAt:    now,
    cancelledAt:  null
  };
}

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

function buildLegs(drops, providerResult, startTime) {
  // Provider gives us legs array — use it if present, otherwise synthesise
  if (providerResult.legs && providerResult.legs.length > 0) {
    return providerResult.legs.map((leg, i) => ({
      from:         leg.from         || drops[i],
      to:           leg.to           || drops[i + 1] || drops[i],
      distanceKm:   leg.distanceKm   || 0,
      durationMin:  leg.durationMin  || 0,
      instructions: leg.instructions || []
    }));
  }

  // Synthesised legs: straight-line haversine between each drop pair
  const legs = [];
  for (let i = 0; i < drops.length - 1; i++) {
    const from = drops[i];
    const to   = drops[i + 1];
    const distKm  = haversineKm(from.lat, from.lon, to.lat, to.lon);
    const durMin  = (distKm / AVG_SPEED_KMH) * 60;
    legs.push({
      from:         { lat: from.lat, lon: from.lon, label: from.label },
      to:           { lat: to.lat,   lon: to.lon,   label: to.label },
      distanceKm:   parseFloat(distKm.toFixed(2)),
      durationMin:  parseFloat(durMin.toFixed(1)),
      instructions: [`Head from ${from.label || "point"} to ${to.label || "next point"}`]
    });
  }
  return legs;
}

function enrichDrops(drops, legs, startTime) {
  let cumulative = 0;
  return drops.map((drop, i) => {
    if (i > 0 && legs[i - 1]) cumulative += legs[i - 1].durationMin;
    return {
      ...drop,
      estimatedArrival: startTime + cumulative * 60 * 1000,
      notes: drop.notes || null
    };
  });
}

// Haversine great-circle distance
const AVG_SPEED_KMH = 50; // conservative urban/mixed average

function haversineKm(lat1, lon1, lat2, lon2) {
  const R  = 6371;
  const dL = toRad(lat2 - lat1);
  const dG = toRad(lon2 - lon1);
  const a  = Math.sin(dL / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toRad(deg) { return deg * Math.PI / 180; }
