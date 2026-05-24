// AP3X API — POST /api/updateFleet (brand config)
import { setFleetBrand } from "../core/branding-engine.js";
import store from "../core/storage.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = setFleetBrand(store, req.body.fleetId, req.body.brand);
    res.status(200).json({ success: true, brand: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}
