// AP3X Device Manager — RUN 2 (AP3X install tracking)
// RULE 1: A device CANNOT exist without fleet registration.
// Devices are AP3X installs on physical hardware (tablets, phones, embedded units).
// boundDriverId is set by identity-binder.js — NOT here.

import { emitEvent } from "./event-emitter.js";
import { listEntities } from "./entity-manager.js";

const VALID_PLATFORMS = ["android", "ios", "linux", "embedded", "web"];

export function registerDevice(store, fleetId, device) {
  // RULE 1 guard
  if (!store.fleets[fleetId]) throw new Error("Fleet not found — device must be registered to an existing fleet");
  if (!device.platform) throw new Error("Device platform is required");

  const deviceId = crypto.randomUUID();

  store.devices[deviceId] = {
    id: deviceId,
    fleetId,
    platform: device.platform,
    ap3xVersion: device.ap3xVersion || "0.0.1",
    hardwareId: device.hardwareId || null,     // physical serial / IMEI
    boundDriverId: null,                        // set by identity-binder
    status: "unbound",                          // unbound → bound (via identity-binder)
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  emitEvent(store, {
    type: "device.registered",
    fleetId,
    entityId: deviceId,
    collection: "devices",
    payload: store.devices[deviceId]
  });

  return store.devices[deviceId];
}

export function getDevice(store, deviceId) {
  const d = store.devices[deviceId];
  if (!d) throw new Error("Device not found");
  return d;
}

export function listDevices(store, fleetId) {
  return listEntities(store, "devices", fleetId);
}

export function deregisterDevice(store, deviceId) {
  const d = store.devices[deviceId];
  if (!d) throw new Error("Device not found");

  if (d.boundDriverId) {
    throw new Error("Cannot deregister a bound device — unbind identity first");
  }

  d.status = "deregistered";
  d.updatedAt = Date.now();

  emitEvent(store, {
    type: "device.deregistered",
    fleetId: d.fleetId,
    entityId: deviceId,
    collection: "devices",
    payload: { deviceId }
  });

  return d;
}
