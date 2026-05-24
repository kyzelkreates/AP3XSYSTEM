// AP3X Routing Engine — RUN 4
// SCOPE: Route computation, vehicle constraint filtering, multi-drop logic.
// NO map UI. NO driver PWA. NO tachograph. Output = route objects only.
// Primary: GraphHopper stub. Fallback: OSM placeholder.

import { emitEvent }       from "../event-emitter.js";
import { validateRoute }   from "./route-validator.js";
import { filterVehicles }  from "./vehicle-constraints.js";
import { buildRouteObject } from "./route-builder.js";
import { graphHopperStub } from "../integrations/graphhopper.js";
import { osmFallback }     from "../integrations/osm-fallback.js";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
export const ROUTE_STATUS = {
  PENDING:   "pending",
  COMPUTED:  "computed",
  VALIDATED: "validated",
  FAILED:    "failed",
  CANCELLED: "cancelled"
};

export const ROUTING_PROVIDER = {
  GRAPHHOPPER: "graphhopper",
  OSM:         "osm_fallback",
  MANUAL:      "manual"
};

// ─── MAIN ENTRY POINT ───────────────────────────────────────────────────────

/**
 * Generate a route for a fleet operation.
 *
 * @param {object} store      - AP3X SSOT
 * @param {string} fleetId    - owning fleet
 * @param {object} routeSpec  - { vehicleId, driverId, drops: [{lat, lon, label, sequence}], options? }
 * @returns {object}          - Route object stored in store.routes
 */
export async function generateRoute(store, fleetId, routeSpec) {
  // ── 1. Validate fleet exists ─────────────────────────────────────────────
  if (!store.fleets[fleetId]) throw new Error("Fleet not found");

  // ── 2. Resolve vehicle + apply constraints ───────────────────────────────
  const vehicle = store.vehicles[routeSpec.vehicleId];
  if (!vehicle) throw new Error("Vehicle not found");
  if (vehicle.fleetId !== fleetId) throw new Error("Vehicle does not belong to this fleet");
  if (vehicle.status !== "active") throw new Error("Vehicle is not active");

  // ── 3. Validate drops ────────────────────────────────────────────────────
  if (!Array.isArray(routeSpec.drops) || routeSpec.drops.length < 1) {
    throw new Error("Route must have at least one drop point");
  }
  if (routeSpec.drops.length > 50) {
    throw new Error("Route exceeds maximum drop limit (50)");
  }

  // ── 4. Validate driver identity (RULE 2 — must be bound) ─────────────────
  if (routeSpec.driverId) {
    const driver = store.drivers[routeSpec.driverId];
    if (!driver) throw new Error("Driver not found");
    if (driver.fleetId !== fleetId) throw new Error("Driver does not belong to this fleet");
    if (!driver.identityId) throw new Error("Driver has no active identity binding — cannot be assigned to route");
  }

  // ── 5. Order drops by sequence ───────────────────────────────────────────
  const orderedDrops = [...routeSpec.drops].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  // ── 6. Attempt route computation ─────────────────────────────────────────
  let providerResult = null;
  let usedProvider   = null;

  try {
    providerResult = await graphHopperStub(vehicle, orderedDrops, routeSpec.options || {});
    usedProvider   = ROUTING_PROVIDER.GRAPHHOPPER;
  } catch (ghErr) {
    console.warn("[AP3X] GraphHopper failed, falling back to OSM:", ghErr.message);
    try {
      providerResult = await osmFallback(vehicle, orderedDrops, routeSpec.options || {});
      usedProvider   = ROUTING_PROVIDER.OSM;
    } catch (osmErr) {
      throw new Error(`All routing providers failed. GH: ${ghErr.message} | OSM: ${osmErr.message}`);
    }
  }

  // ── 7. Build route object ────────────────────────────────────────────────
  const route = buildRouteObject({
    fleetId,
    vehicleId:  routeSpec.vehicleId,
    driverId:   routeSpec.driverId || null,
    drops:      orderedDrops,
    provider:   usedProvider,
    providerResult,
    options:    routeSpec.options || {}
  });

  // ── 8. Validate the generated route ─────────────────────────────────────
  const validation = validateRoute(route, vehicle);
  route.validation = validation;
  route.status = validation.valid ? ROUTE_STATUS.VALIDATED : ROUTE_STATUS.FAILED;

  if (!validation.valid) {
    route.failureReasons = validation.errors;
    emitEvent(store, {
      type: "route.validation.failed",
      fleetId,
      entityId: route.id,
      collection: "routes",
      payload: { routeId: route.id, errors: validation.errors }
    });
    store.routes[route.id] = route;
    return route;
  }

  // ── 9. Persist to SSOT ──────────────────────────────────────────────────
  store.routes[route.id] = route;

  emitEvent(store, {
    type: "route.generated",
    fleetId,
    entityId: route.id,
    collection: "routes",
    payload: {
      routeId:    route.id,
      vehicleId:  route.vehicleId,
      driverId:   route.driverId,
      dropCount:  route.drops.length,
      provider:   route.provider,
      distanceKm: route.summary.distanceKm,
      durationMin:route.summary.durationMin
    }
  });

  return route;
}

// ─── LIST / GET ──────────────────────────────────────────────────────────────

export function getRoute(store, routeId) {
  const route = store.routes[routeId];
  if (!route) throw new Error("Route not found");
  return route;
}

export function listRoutes(store, fleetId) {
  const all = Object.values(store.routes || {});
  return fleetId ? all.filter(r => r.fleetId === fleetId) : all;
}

// ─── CANCEL ─────────────────────────────────────────────────────────────────

export function cancelRoute(store, fleetId, routeId) {
  const route = store.routes[routeId];
  if (!route) throw new Error("Route not found");
  if (route.fleetId !== fleetId) throw new Error("Route does not belong to this fleet");
  if (route.status === ROUTE_STATUS.CANCELLED) throw new Error("Route is already cancelled");

  route.status = ROUTE_STATUS.CANCELLED;
  route.cancelledAt = Date.now();

  emitEvent(store, {
    type: "route.cancelled",
    fleetId,
    entityId: routeId,
    collection: "routes",
    payload: { routeId, cancelledAt: route.cancelledAt }
  });

  return route;
}
