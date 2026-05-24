// AP3X Route Validator — RUN 4
// Validates a generated route object against vehicle constraints and route rules.
// Returns a ValidationResult — never throws. Caller decides what to do with failures.

// ─── LIMITS ──────────────────────────────────────────────────────────────────
const LIMITS = {
  MAX_DISTANCE_KM:       1500,   // hard cap per route
  MAX_DURATION_MIN:      720,    // 12h hard cap (tachograph will enforce in RUN 7+)
  MAX_DROPS:             50,
  MIN_DROPS:             1,
  MAX_LEG_DISTANCE_KM:   300,    // single leg max
  COORD_LAT_RANGE:       [-90, 90],
  COORD_LON_RANGE:       [-180, 180]
};

// ─── VEHICLE CONSTRAINT THRESHOLDS ───────────────────────────────────────────
// UK/EU standard infrastructure limits (enforced by routing provider in RUN 4+)
const VEHICLE_LIMITS = {
  maxHeightM: 4.95,   // standard UK max (5.03 legal, 4.95 practical)
  maxWidthM:  2.55,   // EU standard
  maxWeightT: {
    light:       3.5,
    medium:      18,
    heavy:       44,
    articulated: 44
  }
};

/**
 * Validate a fully-built route object against its vehicle.
 *
 * @param {object} route   - Route object from buildRouteObject
 * @param {object} vehicle - Vehicle from SSOT
 * @returns {ValidationResult} { valid: boolean, errors: string[], warnings: string[] }
 */
export function validateRoute(route, vehicle) {
  const errors   = [];
  const warnings = [];

  // ── A. Structure checks ──────────────────────────────────────────────────
  if (!route.id)      errors.push("Route has no ID");
  if (!route.fleetId) errors.push("Route has no fleetId");
  if (!route.vehicleId) errors.push("Route has no vehicleId");

  // ── B. Drop checks ───────────────────────────────────────────────────────
  const drops = route.drops || [];

  if (drops.length < LIMITS.MIN_DROPS) {
    errors.push(`Route has no drop points (minimum ${LIMITS.MIN_DROPS})`);
  }
  if (drops.length > LIMITS.MAX_DROPS) {
    errors.push(`Route exceeds maximum drop limit: ${drops.length} > ${LIMITS.MAX_DROPS}`);
  }

  drops.forEach((drop, i) => {
    const label = drop.label || `Drop ${i + 1}`;

    if (drop.lat == null || drop.lon == null) {
      errors.push(`${label}: missing coordinates`);
      return;
    }
    if (drop.lat < LIMITS.COORD_LAT_RANGE[0] || drop.lat > LIMITS.COORD_LAT_RANGE[1]) {
      errors.push(`${label}: latitude out of range (${drop.lat})`);
    }
    if (drop.lon < LIMITS.COORD_LON_RANGE[0] || drop.lon > LIMITS.COORD_LON_RANGE[1]) {
      errors.push(`${label}: longitude out of range (${drop.lon})`);
    }
  });

  // ── C. Summary checks ─────────────────────────────────────────────────────
  const summary = route.summary || {};

  if (summary.distanceKm > LIMITS.MAX_DISTANCE_KM) {
    errors.push(`Route distance too long: ${summary.distanceKm}km > ${LIMITS.MAX_DISTANCE_KM}km limit`);
  }
  if (summary.durationMin > LIMITS.MAX_DURATION_MIN) {
    errors.push(`Route duration exceeds limit: ${summary.durationMin}min > ${LIMITS.MAX_DURATION_MIN}min (12h)`);
  }
  if (summary.distanceKm > LIMITS.MAX_DISTANCE_KM * 0.8) {
    warnings.push(`Route is approaching distance limit (${summary.distanceKm}km of ${LIMITS.MAX_DISTANCE_KM}km)`);
  }
  if (summary.durationMin > 480) {
    warnings.push(`Route duration exceeds 8h — tachograph compliance required (RUN 7+)`);
  }

  // ── D. Leg checks ────────────────────────────────────────────────────────
  const legs = route.legs || [];
  legs.forEach((leg, i) => {
    if (leg.distanceKm > LIMITS.MAX_LEG_DISTANCE_KM) {
      errors.push(`Leg ${i + 1}: distance too long (${leg.distanceKm}km > ${LIMITS.MAX_LEG_DISTANCE_KM}km)`);
    }
    if (leg.durationMin <= 0) {
      warnings.push(`Leg ${i + 1}: zero duration — check coordinates`);
    }
  });

  // ── E. Vehicle constraint checks ─────────────────────────────────────────
  if (vehicle) {
    // Height
    if (vehicle.height != null && vehicle.height > VEHICLE_LIMITS.maxHeightM) {
      warnings.push(`Vehicle height (${vehicle.height}m) exceeds standard infrastructure limit (${VEHICLE_LIMITS.maxHeightM}m) — provider must apply height restrictions`);
    }
    // Width
    if (vehicle.width != null && vehicle.width > VEHICLE_LIMITS.maxWidthM) {
      warnings.push(`Vehicle width (${vehicle.width}m) exceeds EU standard (${VEHICLE_LIMITS.maxWidthM}m) — wide load rules apply`);
    }
    // Weight class
    const weightClass = vehicle.weightClass || "medium";
    const maxT = VEHICLE_LIMITS.maxWeightT[weightClass];
    if (!maxT) {
      warnings.push(`Unknown weight class: ${weightClass}`);
    }

    // Fuel type advisory
    if (vehicle.fuelType === "electric") {
      if (summary.distanceKm > 250) {
        warnings.push(`Electric vehicle: route distance (${summary.distanceKm}km) may require en-route charging — no charge point logic yet (RUN 4+)`);
      }
    }
  }

  // ── F. Provider check ────────────────────────────────────────────────────
  if (!route.provider) {
    errors.push("Route has no routing provider — cannot verify computation");
  }

  return {
    valid:    errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Quick constraint check — used by vehicle-constraints.js before route generation.
 * Returns true if the vehicle CAN physically attempt this route spec.
 */
export function vehicleCanRoute(vehicle, routeSpec) {
  const reasons = [];

  if (!vehicle || vehicle.status !== "active") {
    reasons.push("Vehicle is not active");
  }
  if (routeSpec.drops && routeSpec.drops.length > LIMITS.MAX_DROPS) {
    reasons.push(`Too many drops: ${routeSpec.drops.length}`);
  }

  return { allowed: reasons.length === 0, reasons };
}

export { LIMITS, VEHICLE_LIMITS };
