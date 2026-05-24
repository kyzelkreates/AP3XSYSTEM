// AP3X Deployment Orchestrator — generate deployment objects, emit events
import { emitEvent } from "./event-emitter.js";

export function deployFleet(store, fleetId) {
  const fleet = store.fleets[fleetId];
  if (!fleet) throw new Error("Fleet not found");

  const deployment = {
    id: crypto.randomUUID(),
    fleetId,
    version: Date.now(),
    status: "deploying",
    createdAt: Date.now()
  };

  store.deployments[deployment.id] = deployment;

  emitEvent(store, {
    type: "deployment.created",
    fleetId,
    payload: deployment
  });

  return deployment;
}

export function listDeployments(store, fleetId) {
  const all = Object.values(store.deployments);
  return fleetId ? all.filter(d => d.fleetId === fleetId) : all;
}
