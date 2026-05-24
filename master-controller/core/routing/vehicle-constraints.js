// AP3X Vehicle Constraints Filter — RUN 4
// Filters candidate vehicles for a route based on physical constraints.
// This is the pre-routing gate — only valid vehicles reach the routing provider.
// RUN 4+ routing providers (GH, OSM) receive constraints as query params.

import { VEHICLE_LIMITS } from "./route-validator.js";

// ─── CONSTRAINT PROFILES ─────────────────────────────────────────────────────
// Profiles map to common infrastructure restriction tiers.
// These will be used as GH/OSM filter params in RUN 4 live integration.

export const CONSTRAINT_PROFILES = {
  urban: {
    label:       "Urban / City Centre",
    maxHeightM:  4.0,     // many city bridges, car parks, barriers
    maxWidthM:   2.3,
    maxWeightT:  7.5,
    fuelAllowed: ["diesel", "petrol", "electric", "hybrid", "lpg"],
    notes:       "LEZ/CAZ rules apply — electric/hybrid preferred"
  },
  standard: {
    label:       "Standard Road",
    maxHeightM:  4.65,
    maxWidthM:   2.55,
    maxWeightT:  44,
    fuelAllowed: ["diesel", "petrol", "electric", "hybrid", "hydrogen", "lpg"],
    notes:       ""
  },
  motorway: {
    label:       "Motorway / Trunk Road",
    maxHeightM:  4.95,
    maxWidthM:   2.55,
    maxWeightT:  44,
    fuelAllowed: ["diesel", "petrol", "electric", "hybrid", "hydrogen", "lpg"],
    notes:       "High clearance — articulated vehicles permitted"
  },
  hazmat: {
    label:       "Hazardous Materials Route",
    maxHeightM:  4.65,
    maxWidthM:   2.55,
    maxWeightT:  44,
    fuelAllowed: ["diesel"],    // strict — no LPG/hydrogen on hazmat routes
    notes:       "ADR certification required — not enforced here (RUN 5+)"
  },
  lowBridge: {
    label:       "Low Bridge / Restricted",
    maxHeightM:  3.0,
    maxWidthM:   2.3,
    maxWeightT:  7.5,
    fuelAllowed: ["diesel", "petrol", "electric", "hybrid", "lpg"],
    notes:       "Strict height check — tall vehicles must use alternate route"
  }
};

// ─── CONSTRAINT SNAPSHOT ─────────────────────────────────────────────────────

/**
 * Build a constraint snapshot for a vehicle.
 * This snapshot travels with the route object — immutable record of what was checked.
 *
 * @param {object} vehicle
 * @param {string} profile - key of CONSTRAINT_PROFILES (default: "standard")
 * @returns {object} constraintsSnapshot
 */
export function buildConstraintSnapshot(vehicle, profile = "standard") {
  const prof = CONSTRAINT_PROFILES[profile] || CONSTRAINT_PROFILES.standard;

  return {
    profile:     profile,
    profileLabel:prof.label,
    vehicle: {
      id:          vehicle.id,
      type:        vehicle.type,
      weightClass: vehicle.weightClass,
      height:      vehicle.height,
      width:       vehicle.width,
      fuelType:    vehicle.fuelType
    },
    limits: {
      maxHeightM:  prof.maxHeightM,
      maxWidthM:   prof.maxWidthM,
      maxWeightT:  prof.maxWeightT
    },
    snapshotAt: Date.now()
  };
}

// ─── VEHICLE FILTER ───────────────────────────────────────────────────────────

/**
 * Filter a list of vehicles to only those capable of running a given route spec.
 *
 * @param {object[]} vehicles   - array of vehicle objects from SSOT
 * @param {object} routeSpec    - { drops, options: { profile? } }
 * @returns {{ eligible: object[], rejected: { vehicle, reasons }[] }}
 */
export function filterVehicles(vehicles, routeSpec) {
  const profile = (routeSpec.options && routeSpec.options.constraintProfile) || "standard";
  const prof    = CONSTRAINT_PROFILES[profile] || CONSTRAINT_PROFILES.standard;
  const eligible = [];
  const rejected = [];

  for (const v of vehicles) {
    const reasons = [];

    if (v.status !== "active") {
      reasons.push(`Vehicle not active (status: ${v.status})`);
    }

    // Height check
    if (v.height != null && v.height > prof.maxHeightM) {
      reasons.push(`Height ${v.height}m exceeds profile limit ${prof.maxHeightM}m (${profile})`);
    }

    // Width check
    if (v.width != null && v.width > prof.maxWidthM) {
      reasons.push(`Width ${v.width}m exceeds profile limit ${prof.maxWidthM}m (${profile})`);
    }

    // Weight class check
    const weightMap = { light: 3.5, medium: 18, heavy: 32, articulated: 44 };
    const vehicleMaxT = weightMap[v.weightClass] || 18;
    if (vehicleMaxT > prof.maxWeightT) {
      reasons.push(`Weight class "${v.weightClass}" (≤${vehicleMaxT}t) not permitted on profile "${profile}" (max ${prof.maxWeightT}t)`);
    }

    // Fuel type check
    if (v.fuelType && !prof.fuelAllowed.includes(v.fuelType)) {
      reasons.push(`Fuel type "${v.fuelType}" not permitted on profile "${profile}"`);
    }

    if (reasons.length === 0) {
      eligible.push(v);
    } else {
      rejected.push({ vehicle: v, reasons });
    }
  }

  return { eligible, rejected };
}

// ─── SINGLE VEHICLE CHECK ────────────────────────────────────────────────────

/**
 * Check a single vehicle against a constraint profile.
 * Returns { allowed, reasons, profile }.
 */
export function checkVehicleConstraints(vehicle, profile = "standard") {
  const { eligible, rejected } = filterVehicles([vehicle], { options: { constraintProfile: profile } });
  if (eligible.length > 0) {
    return { allowed: true, reasons: [], profile };
  }
  return { allowed: false, reasons: rejected[0]?.reasons || [], profile };
}
