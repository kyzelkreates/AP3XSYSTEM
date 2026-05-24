// AP3X Branding Engine — assign and retrieve fleet brand configs
import { emitEvent } from "./event-emitter.js";

export function setFleetBrand(store, fleetId, brand) {
  if (!store.fleets[fleetId]) throw new Error("Fleet not found");

  store.fleetBrands[fleetId] = {
    logo: brand.logo || null,
    primaryColor: brand.primaryColor || "#7C3AED",
    secondaryColor: brand.secondaryColor || "#1E1E2E",
    updatedAt: Date.now()
  };

  emitEvent(store, {
    type: "fleet.brand.updated",
    fleetId,
    payload: store.fleetBrands[fleetId]
  });

  return store.fleetBrands[fleetId];
}

export function getFleetBrand(store, fleetId) {
  return store.fleetBrands[fleetId] || null;
}
