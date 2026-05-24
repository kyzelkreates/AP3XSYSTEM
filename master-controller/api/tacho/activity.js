// AP3X API — POST /api/tacho/activity
// Records a driver activity change in the tachograph engine.
// Called by the PWA tacho-logger.js via sync-agent queue.

import { recordActivity, getActiveSession } from "../../core/compliance/tachograph-engine.js";
import store                                from "../../core/storage.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { driverId, fleetId, activityType, time } = req.body || {};
  if (!driverId || !activityType) return res.status(400).json({ error: "driverId and activityType required" });

  try {
    // Ensure there is an active session — if not, auto-start one
    let session = getActiveSession(store, driverId);
    if (!session) {
      return res.status(409).json({
        error: "No active tachograph session for driver",
        driverId,
        hint:  "Start a session via /api/tacho/session first"
      });
    }

    const result = recordActivity(store, driverId, activityType, time ? new Date(time) : undefined);

    return res.status(200).json({
      sessionId:    result.session.id,
      activityType: result.activityType,
      violations:   result.violations || [],
      accum:        result.session.accum,
      updatedAt:    Date.now()
    });
  } catch (err) {
    console.error("[API] tacho/activity error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
