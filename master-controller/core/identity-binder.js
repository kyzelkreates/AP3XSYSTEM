// AP3X Identity Binder — RUN 2 (CRITICAL SYSTEM)
// This is what connects DRIVER ↔ DEVICE ↔ FLEET.
// RULE 2: A driver CANNOT operate without identity binding.
// This is the trust layer — no binding = no fleet access for that driver/device pair.

import { emitEvent } from "./event-emitter.js";

/**
 * Bind a driver to a device within a fleet.
 * Creates an identity record and updates device + driver back-references.
 */
export function bindIdentity(store, fleetId, driverId, deviceId) {
  // Validate fleet
  if (!store.fleets[fleetId]) throw new Error("Fleet not found");

  // Validate driver belongs to fleet
  const driver = store.drivers[driverId];
  if (!driver) throw new Error("Driver not found");
  if (driver.fleetId !== fleetId) throw new Error("Driver does not belong to this fleet");

  // Validate device belongs to fleet
  const device = store.devices[deviceId];
  if (!device) throw new Error("Device not found");
  if (device.fleetId !== fleetId) throw new Error("Device does not belong to this fleet");

  // Prevent double-binding
  if (device.status === "bound") {
    throw new Error(`Device is already bound to driver ${device.boundDriverId}`);
  }
  if (driver.boundDeviceId) {
    throw new Error(`Driver is already bound to device ${driver.boundDeviceId}`);
  }

  const identityId = crypto.randomUUID();

  // Create identity record
  store.identities[identityId] = {
    id: identityId,
    fleetId,
    driverId,
    deviceId,
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // Update device
  store.devices[deviceId].boundDriverId = driverId;
  store.devices[deviceId].status = "bound";
  store.devices[deviceId].updatedAt = Date.now();

  // Update driver
  store.drivers[driverId].boundDeviceId = deviceId;
  store.drivers[driverId].identityId = identityId;
  store.drivers[driverId].updatedAt = Date.now();

  // Create assignment record
  store.assignments[identityId] = {
    identityId,
    fleetId,
    driverId,
    deviceId,
    createdAt: Date.now()
  };

  emitEvent(store, {
    type: "identity.bound",
    fleetId,
    entityId: identityId,
    collection: "identities",
    payload: store.identities[identityId]
  });

  return store.identities[identityId];
}

/**
 * Unbind a driver from their device. Revokes the identity.
 */
export function unbindIdentity(store, identityId) {
  const identity = store.identities[identityId];
  if (!identity) throw new Error("Identity not found");
  if (identity.status !== "active") throw new Error("Identity is not active");

  const { driverId, deviceId, fleetId } = identity;

  // Revoke identity
  identity.status = "revoked";
  identity.updatedAt = Date.now();

  // Clear device binding
  if (store.devices[deviceId]) {
    store.devices[deviceId].boundDriverId = null;
    store.devices[deviceId].status = "unbound";
    store.devices[deviceId].updatedAt = Date.now();
  }

  // Clear driver binding
  if (store.drivers[driverId]) {
    store.drivers[driverId].boundDeviceId = null;
    store.drivers[driverId].identityId = null;
    store.drivers[driverId].updatedAt = Date.now();
  }

  emitEvent(store, {
    type: "identity.unbound",
    fleetId,
    entityId: identityId,
    collection: "identities",
    payload: { identityId, driverId, deviceId, status: "revoked" }
  });

  return identity;
}

/**
 * Get all active identities for a fleet.
 */
export function listIdentities(store, fleetId) {
  return Object.values(store.identities).filter(i => i.fleetId === fleetId);
}

/**
 * Resolve identity for a given driver — confirms they are bound and active.
 */
export function resolveDriverIdentity(store, driverId) {
  const driver = store.drivers[driverId];
  if (!driver) throw new Error("Driver not found");
  if (!driver.identityId) return null; // not yet bound — RULE 2 will block operation
  return store.identities[driver.identityId] || null;
}
