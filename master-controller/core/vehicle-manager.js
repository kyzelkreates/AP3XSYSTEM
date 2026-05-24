// AP3X Vehicle Manager — RUN 2
// RULE 3: A vehicle MUST have fleet assignment before route usage.
// Route usage enforcement happens in RUN 4+ routing engine. This file stores and validates the fleet binding.

import { emitEvent } from "./event-emitter.js";
import { listEntities } from "./entity-manager.js";

const VALID_FUEL_TYPES = ["diesel", "petrol", "electric", "hybrid", "hydrogen", "lpg"];
const VALID_WEIGHT_CLASSES = ["light", "medium", "heavy", "articulated"];

export function createVehicle(store, fleetId, vehicle) {
  // RULE 3 guard: fleet must exist
  if (!store.fleets[fleetId]) throw new Error("Fleet not found — vehicle must be assigned to a registered fleet");
  if (!vehicle.type) throw new Error("Vehicle type is required");

  const vehicleId = crypto.randomUUID();

  store.vehicles[vehicleId] = {
    id: vehicleId,
    fleetId,
    type: vehicle.type,
    weightClass: vehicle.weightClass || "medium",
    height: vehicle.height || null,          // metres — used by routing engine (RUN 4+)
    width: vehicle.width || null,            // metres — used by routing engine (RUN 4+)
    fuelType: vehicle.fuelType || "diesel",
    registration: vehicle.registration || null,
    status: "active",
    assignedDriverId: null,                  // set by identity-binder or assignment layer
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  emitEvent(store, {
    type: "vehicle.created",
    fleetId,
    entityId: vehicleId,
    collection: "vehicles",
    payload: store.vehicles[vehicleId]
  });

  return store.vehicles[vehicleId];
}

export function getVehicle(store, vehicleId) {
  const v = store.vehicles[vehicleId];
  if (!v) throw new Error("Vehicle not found");
  return v;
}

export function listVehicles(store, fleetId) {
  return listEntities(store, "vehicles", fleetId);
}

export function updateVehicleStatus(store, vehicleId, status) {
  const v = store.vehicles[vehicleId];
  if (!v) throw new Error("Vehicle not found");

  v.status = status;
  v.updatedAt = Date.now();

  emitEvent(store, {
    type: "vehicle.status.updated",
    fleetId: v.fleetId,
    entityId: vehicleId,
    collection: "vehicles",
    payload: { vehicleId, status }
  });

  return v;
}
