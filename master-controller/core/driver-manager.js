// AP3X Driver Manager — RUN 2
// RULE: A driver CANNOT operate without identity binding (enforced in identity-binder.js).
// RULE: A driver CANNOT exist without fleet registration.

import { emitEvent } from "./event-emitter.js";
import { listEntities } from "./entity-manager.js";

export function createDriver(store, fleetId, driver) {
  // RULE 2 guard: fleet must exist
  if (!store.fleets[fleetId]) throw new Error("Fleet not found — driver must belong to a registered fleet");
  if (!driver.name) throw new Error("Driver name is required");
  if (!driver.licenseType) throw new Error("Driver licenseType is required");

  const driverId = crypto.randomUUID();

  store.drivers[driverId] = {
    id: driverId,
    fleetId,
    name: driver.name,
    licenseType: driver.licenseType,
    status: "active",
    boundDeviceId: null,    // set by identity-binder
    identityId: null,       // set by identity-binder
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  emitEvent(store, {
    type: "driver.created",
    fleetId,
    entityId: driverId,
    collection: "drivers",
    payload: store.drivers[driverId]
  });

  return store.drivers[driverId];
}

export function getDriver(store, driverId) {
  const driver = store.drivers[driverId];
  if (!driver) throw new Error("Driver not found");
  return driver;
}

export function listDrivers(store, fleetId) {
  return listEntities(store, "drivers", fleetId);
}

export function updateDriverStatus(store, driverId, status) {
  const driver = store.drivers[driverId];
  if (!driver) throw new Error("Driver not found");

  driver.status = status;
  driver.updatedAt = Date.now();

  emitEvent(store, {
    type: "driver.status.updated",
    fleetId: driver.fleetId,
    entityId: driverId,
    collection: "drivers",
    payload: { driverId, status }
  });

  return driver;
}
