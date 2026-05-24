// AP3X API — POST /api/hazard/confirm
// Driver corroborates that a hazard is still present.
// Increments confirmation count — does not modify hazard state otherwise.

import store from "../../core/storage.js";
import { emitEvent } from "../../core/event-emitter.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { hazardId, driverId, fleetId } = req.body || {};
  if (!hazardId) return res.status(400).json({ error: "hazardId required" });

  const hazard = store.hazards[hazardId];
  if (!hazard)  return res.status(404).json({ error: "Hazard not found" });

  // Increment confirmations — read current, write new (no mutation of other fields)
  store.hazards[hazardId] = {
    ...hazard,
    confirmations: (hazard.confirmations || 0) + 1,
    lastConfirmedAt: Date.now(),
    lastConfirmedBy: driverId || null
  };

  emitEvent(store, {
    type:     "hazard.confirmed",
    fleetId,
    entityId: hazardId,
    payload:  { hazardId, driverId, confirmations: store.hazards[hazardId].confirmations }
  });

  return res.status(200).json({ hazardId, confirmations: store.hazards[hazardId].confirmations });
}
