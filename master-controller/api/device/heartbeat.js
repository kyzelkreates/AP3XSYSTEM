// AP3X API — POST /api/device/heartbeat
// Receives periodic heartbeats from driver PWA devices.
// Updates device last-seen timestamp and online status in SSOT.

import store         from "../../core/storage.js";
import { emitEvent } from "../../core/event-emitter.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { deviceId, driverId, fleetId, timestamp, userAgent } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  const now = Date.now();

  // Update or register device record
  const existing = store.devices[deviceId] || {};
  store.devices[deviceId] = {
    ...existing,
    id:           deviceId,
    driverId:     driverId     || existing.driverId,
    fleetId:      fleetId      || existing.fleetId,
    userAgent:    userAgent    || existing.userAgent,
    lastSeenAt:   now,
    lastHeartbeatAt: now,
    online:       true,
    clientTs:     timestamp    || now
  };

  // Emit debug-level heartbeat event (not audit-grade)
  emitEvent(store, {
    type:     "device.heartbeat",
    fleetId:  fleetId || existing.fleetId,
    entityId: deviceId,
    payload:  { deviceId, driverId, clientTs: timestamp }
  });

  return res.status(200).json({ ack: true, serverTs: now });
}
