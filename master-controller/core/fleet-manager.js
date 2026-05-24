// AP3X Fleet Manager — create and manage fleets
import { emitEvent } from "./event-emitter.js";

export function createFleet(store, data) {
  if (!data.name) throw new Error("Fleet name is required");

  const fleetId = crypto.randomUUID();

  store.fleets[fleetId] = {
    id: fleetId,
    name: data.name,
    createdAt: Date.now(),
    status: "active",
    config: {
      vehicles: [],
      drivers: [],
      rules: {}
    }
  };

  emitEvent(store, {
    type: "fleet.created",
    fleetId,
    payload: store.fleets[fleetId]
  });

  return store.fleets[fleetId];
}

export function getFleet(store, fleetId) {
  const fleet = store.fleets[fleetId];
  if (!fleet) throw new Error("Fleet not found");
  return fleet;
}

export function listFleets(store) {
  return Object.values(store.fleets);
}
