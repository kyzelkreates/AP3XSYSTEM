// AP3X API — POST /api/deployFleet
import { deployFleet } from "../core/deployment-orchestrator.js";
import store from "../core/storage.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const deployment = deployFleet(store, req.body.fleetId);
    res.status(200).json({ success: true, deployment });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}
