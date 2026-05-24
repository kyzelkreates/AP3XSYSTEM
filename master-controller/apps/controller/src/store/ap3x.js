// AP3X Master Controller — Client SSOT (mirrors server storage.js)
// localStorage-backed reactive store. All mutations go through actions.
// Components read via useAP3X hook.

import { createContext, useContext, useReducer, useEffect, useRef, useCallback } from "react";

const STORE_KEY = "ap3x_store_v2";

function defaultStore() {
  return {
    fleets:          {},
    fleetBrands:     {},
    deployments:     {},
    drivers:         {},
    vehicles:        {},
    devices:         {},
    identities:      {},
    assignments:     {},
    permissions:     {},
    routes:          {},
    safetyDecisions: {},
    hazards:         {},
    hazardBroadcasts:{},
    tileJobs:        {},
    tacho:           {},
    syncQueue:       {},
    syncConflicts:   {},
    bundles:         {},
    events:          [],
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultStore();
    return { ...defaultStore(), ...JSON.parse(raw) };
  } catch {
    return defaultStore();
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {}
}

// ── Reducer ────────────────────────────────────────────────────────────────

function emitLocal(store, event) {
  const enriched = {
    id:        crypto.randomUUID(),
    timestamp: Date.now(),
    status:    "pending",
    ...event,
  };
  return {
    ...store,
    events: [enriched, ...store.events].slice(0, 500),
  };
}

function reducer(state, action) {
  let next = state;

  switch (action.type) {

    // Fleet
    case "FLEET_CREATE": {
      const fleet = { id: crypto.randomUUID(), status: "active", createdAt: Date.now(), ...action.payload };
      next = { ...state, fleets: { ...state.fleets, [fleet.id]: fleet } };
      next = emitLocal(next, { type: "fleet.created", fleetId: fleet.id, payload: fleet });
      break;
    }
    case "FLEET_UPDATE": {
      const { fleetId, data } = action.payload;
      next = { ...state, fleets: { ...state.fleets, [fleetId]: { ...state.fleets[fleetId], ...data, updatedAt: Date.now() } } };
      next = emitLocal(next, { type: "fleet.updated", fleetId, payload: data });
      break;
    }

    // Driver
    case "DRIVER_CREATE": {
      const driver = { id: crypto.randomUUID(), status: "active", boundDeviceId: null, identityId: null, createdAt: Date.now(), updatedAt: Date.now(), ...action.payload };
      next = { ...state, drivers: { ...state.drivers, [driver.id]: driver } };
      next = emitLocal(next, { type: "driver.created", fleetId: driver.fleetId, entityId: driver.id, payload: driver });
      break;
    }

    // Vehicle
    case "VEHICLE_CREATE": {
      const vehicle = { id: crypto.randomUUID(), status: "active", assignedDriverId: null, createdAt: Date.now(), updatedAt: Date.now(), ...action.payload };
      next = { ...state, vehicles: { ...state.vehicles, [vehicle.id]: vehicle } };
      next = emitLocal(next, { type: "vehicle.created", fleetId: vehicle.fleetId, entityId: vehicle.id, payload: vehicle });
      break;
    }

    // Device
    case "DEVICE_REGISTER": {
      const device = { id: crypto.randomUUID(), status: "unbound", boundDriverId: null, createdAt: Date.now(), updatedAt: Date.now(), ...action.payload };
      next = { ...state, devices: { ...state.devices, [device.id]: device } };
      next = emitLocal(next, { type: "device.registered", fleetId: device.fleetId, entityId: device.id, payload: device });
      break;
    }

    // Identity bind
    case "IDENTITY_BIND": {
      const { fleetId, driverId, deviceId } = action.payload;
      const identityId = crypto.randomUUID();
      const identity = { id: identityId, fleetId, driverId, deviceId, status: "active", createdAt: Date.now(), updatedAt: Date.now() };
      next = {
        ...state,
        identities: { ...state.identities, [identityId]: identity },
        drivers: { ...state.drivers, [driverId]: { ...state.drivers[driverId], boundDeviceId: deviceId, identityId, updatedAt: Date.now() } },
        devices: { ...state.devices, [deviceId]: { ...state.devices[deviceId], boundDriverId: driverId, status: "bound", updatedAt: Date.now() } },
      };
      next = emitLocal(next, { type: "identity.bound", fleetId, entityId: identityId, payload: identity });
      break;
    }

    // Identity unbind
    case "IDENTITY_UNBIND": {
      const { identityId } = action.payload;
      const identity = state.identities[identityId];
      if (!identity) break;
      next = {
        ...state,
        identities: { ...state.identities, [identityId]: { ...identity, status: "revoked", updatedAt: Date.now() } },
        drivers: { ...state.drivers, [identity.driverId]: { ...state.drivers[identity.driverId], boundDeviceId: null, identityId: null, updatedAt: Date.now() } },
        devices: { ...state.devices, [identity.deviceId]: { ...state.devices[identity.deviceId], boundDriverId: null, status: "unbound", updatedAt: Date.now() } },
      };
      next = emitLocal(next, { type: "identity.unbound", fleetId: identity.fleetId, entityId: identityId, payload: { identityId, status: "revoked" } });
      break;
    }

    // Route
    case "ROUTE_ADD": {
      const route = action.payload;
      next = { ...state, routes: { ...state.routes, [route.id]: route } };
      next = emitLocal(next, { type: "route.created", fleetId: route.fleetId, entityId: route.id, payload: { routeId: route.id } });
      break;
    }

    // Safety decision
    case "SAFETY_DECISION_ADD": {
      const decision = action.payload;
      next = { ...state, safetyDecisions: { ...state.safetyDecisions, [decision.id]: decision } };
      next = emitLocal(next, { type: decision.approved ? "route.approved" : "route.rejected", fleetId: decision.fleetId, entityId: decision.routeId, payload: decision });
      break;
    }

    // Deployment
    case "DEPLOYMENT_ADD": {
      const dep = { id: crypto.randomUUID(), status: "deploying", createdAt: Date.now(), ...action.payload };
      next = { ...state, deployments: { ...state.deployments, [dep.id]: dep } };
      next = emitLocal(next, { type: "deployment.created", fleetId: dep.fleetId, entityId: dep.id, payload: dep });
      break;
    }
    case "DEPLOYMENT_UPDATE": {
      const { deploymentId, data } = action.payload;
      next = { ...state, deployments: { ...state.deployments, [deploymentId]: { ...state.deployments[deploymentId], ...data } } };
      break;
    }

    // Hazard
    case "HAZARD_ADD": {
      const hazard = action.payload;
      next = { ...state, hazards: { ...state.hazards, [hazard.id]: hazard } };
      next = emitLocal(next, { type: "hazard.reported", fleetId: hazard.fleetId, entityId: hazard.id, payload: hazard });
      break;
    }

    // Raw event injection (from server sync)
    case "EVENT_INJECT":
      next = { ...state, events: [action.payload, ...state.events].slice(0, 500) };
      break;

    // Full store replace (import/restore)
    case "STORE_REPLACE":
      next = { ...defaultStore(), ...action.payload };
      break;

    default:
      return state;
  }

  saveStore(next);
  return next;
}

// ── Context ────────────────────────────────────────────────────────────────

import React from "react";

export const AP3XContext = createContext(null);

export function AP3XProvider({ children }) {
  const [store, dispatch] = useReducer(reducer, null, loadStore);
  return React.createElement(AP3XContext.Provider, { value: { store, dispatch } }, children);
}

export function useAP3X() {
  return useContext(AP3XContext);
}

// ── Selectors ──────────────────────────────────────────────────────────────

export const sel = {
  fleets:      (s) => Object.values(s.fleets),
  fleet:       (s, id) => s.fleets[id],
  drivers:     (s, fleetId) => Object.values(s.drivers).filter(d => !fleetId || d.fleetId === fleetId),
  vehicles:    (s, fleetId) => Object.values(s.vehicles).filter(v => !fleetId || v.fleetId === fleetId),
  devices:     (s, fleetId) => Object.values(s.devices).filter(d => !fleetId || d.fleetId === fleetId),
  identities:  (s, fleetId) => Object.values(s.identities).filter(i => !fleetId || i.fleetId === fleetId),
  routes:      (s, fleetId) => Object.values(s.routes).filter(r => !fleetId || r.fleetId === fleetId),
  deployments: (s, fleetId) => Object.values(s.deployments).filter(d => !fleetId || d.fleetId === fleetId),
  hazards:     (s, fleetId) => Object.values(s.hazards).filter(h => !fleetId || h.fleetId === fleetId),
  events:      (s, filter)  => filter ? s.events.filter(e => e.type?.startsWith(filter)) : s.events,
  safetyDecisions: (s, fleetId) => Object.values(s.safetyDecisions).filter(d => !fleetId || d.fleetId === fleetId),
};
