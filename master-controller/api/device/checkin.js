// AP3X API — POST /api/device/checkin
// Device first-contact registration / re-registration.
// Called when a driver PWA boots with identity params from fleet provisioning.
// Returns the full device context needed by the PWA.

import store         from "../../core/storage.js";
import { emitEvent } from "../../core/event-emitter.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { deviceId, driverId, fleetId, userAgent } = req.body || {};
  if (!deviceId || !driverId || !fleetId) {
    return res.status(400).json({ error: "deviceId, driverId, and fleetId required" });
  }

  // Validate fleet exists
  const fleet = store.fleets[fleetId];
  if (!fleet) return res.status(404).json({ error: `Fleet not found: ${fleetId}` });

  // Validate driver exists in fleet
  const driver = store.drivers[driverId];
  if (!driver || driver.fleetId !== fleetId) {
    return res.status(403).json({ error: "Driver not authorised for this fleet" });
  }

  const now = Date.now();

  // Register or update device
  const existing = store.devices[deviceId] || {};
  store.devices[deviceId] = {
    ...existing,
    id:           deviceId,
    driverId,
    fleetId,
    userAgent:    userAgent || existing.userAgent,
    registeredAt: existing.registeredAt || now,
    lastSeenAt:   now,
    online:       true
  };

  emitEvent(store, {
    type:     "device.checkin",
    fleetId,
    entityId: deviceId,
    payload:  { deviceId, driverId, userAgent }
  });

  // Return full context to device
  return res.status(200).json({
    deviceId,
    driverId,
    fleetId,
    driverName:    driver.name     || null,
    fleetName:     fleet.name      || null,
    regulation:    fleet.regulation || "eu_561",
    checkedInAt:   now,
    serverTs:      now
  });
}
