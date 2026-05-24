// AP3X API — POST /api/hazard/dispute
// Driver disputes a hazard (reports it as gone / inaccurate).
// Routes through hazard-manager.disputeHazard() — single source of logic.
//
// Body: { hazardId, driverId, fleetId }

import { disputeHazard } from "../../core/hazards/hazard-manager.js";
import store             from "../../core/storage.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { hazardId, driverId, fleetId } = req.body || {};
  if (!hazardId) return res.status(400).json({ error: "hazardId required" });
  if (!driverId) return res.status(400).json({ error: "driverId required" });
  if (!fleetId)  return res.status(400).json({ error: "fleetId required" });

  const hazard = store.hazards?.[hazardId];
  if (!hazard)   return res.status(404).json({ error: `Hazard not found: ${hazardId}` });

  try {
    const updated = disputeHazard(store, fleetId, hazardId, driverId);
    return res.status(200).json({
      hazardId,
      rejections:   updated.rejections,
      status:       updated.status,
      autoResolved: updated.status === "resolved"
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
