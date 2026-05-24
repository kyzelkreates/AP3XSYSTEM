// AP3X API — POST /api/hazard/report
// Accepts a driver hazard report from the PWA sync agent.
// Validates, creates the hazard in the SSOT, and broadcasts to fleet.

import { createHazard }         from "../../core/hazards/hazard-manager.js";
import { broadcastHazard }      from "../../core/hazards/hazard-broadcast.js";
import { validateHazardReport } from "../../core/hazards/hazard-validator.js";
import store                    from "../../core/storage.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { fleetId, report } = req.body || {};
  if (!fleetId || !report)  return res.status(400).json({ error: "fleetId and report required" });

  // Validate
  const validation = validateHazardReport(report);
  if (!validation.valid) return res.status(422).json({ error: "Invalid report", details: validation.errors });

  try {
    // Create hazard in SSOT
    const hazard    = await createHazard(store, fleetId, report);

    // Broadcast to fleet
    const broadcast = await broadcastHazard(store, hazard.id, fleetId);

    return res.status(201).json({ hazardId: hazard.id, broadcastId: broadcast?.id || null, status: "reported" });
  } catch (err) {
    console.error("[API] hazard/report error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
