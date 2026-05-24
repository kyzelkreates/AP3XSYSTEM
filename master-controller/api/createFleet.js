// AP3X API — POST /api/createFleet
import { createFleet } from "../core/fleet-manager.js";
import store from "../core/storage.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const fleet = createFleet(store, req.body);
    res.status(201).json({ success: true, fleet });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}
