// AP3X API — POST /api/hazard/dispute
// Driver disputes a hazard (reports it as gone / inaccurate).
// Increments rejection count. Fleet admin resolves if rejections exceed threshold.

import store       from "../../core/storage.js";
import { emitEvent } from "../../core/event-emitter.js";

const AUTO_RESOLVE_THRESHOLD = 3; // auto-resolve if 3+ rejections and 0 recent confirmations

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { hazardId, driverId, fleetId } = req.body || {};
  if (!hazardId) return res.status(400).json({ error: "hazardId required" });

  const hazard = store.hazards[hazardId];
  if (!hazard)  return res.status(404).json({ error: "Hazard not found" });

  const rejections    = (hazard.rejections || 0) + 1;
  const confirmations = hazard.confirmations || 0;

  // Auto-resolve: more rejections than confirmations and over threshold
  const shouldResolve = rejections >= AUTO_RESOLVE_THRESHOLD && rejections > confirmations;

  store.hazards[hazardId] = {
    ...hazard,
    rejections,
    lastDisputedAt: Date.now(),
    lastDisputedBy: driverId || null,
    ...(shouldResolve ? { status: "resolved", resolvedAt: Date.now(), resolvedReason: "auto_dispute" } : {})
  };

  emitEvent(store, {
    type:     shouldResolve ? "hazard.auto_resolved" : "hazard.disputed",
    fleetId,
    entityId: hazardId,
    payload:  { hazardId, driverId, rejections, autoResolved: shouldResolve }
  });

  return res.status(200).json({ hazardId, rejections, autoResolved: shouldResolve });
}
