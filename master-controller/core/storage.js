// AP3X AI Master Controller — SSOT (RUN 10 EXTENDED)
// Single Source of Truth. No direct mutation from outside this module.
// All state mutations must go through entity managers and emit events.
//
// RUN 1:  fleets, fleetBrands, deployments, events
// RUN 2:  drivers, vehicles, devices, identities, assignments, permissions
// RUN 4:  routes
// RUN 5:  safetyDecisions
// RUN 6:  hazards, hazardBroadcasts
// RUN 7:  tileJobs (IndexedDB holds tile blobs — SSOT holds job refs only)
// RUN 8:  tacho (tachograph sessions + compliance ledger)
// RUN 10: syncQueue, syncConflicts (sync engine state — audit refs only)

export const store = {
  // RUN 1
  fleets:           {},
  fleetBrands:      {},
  deployments:      {},

  // RUN 2
  drivers:          {},
  vehicles:         {},
  devices:          {},
  identities:       {},
  assignments:      {},
  permissions:      {},

  // RUN 4
  routes:           {},

  // RUN 5
  safetyDecisions:  {},

  // RUN 6
  hazards:          {},
  hazardBroadcasts: {},

  // RUN 7 — job index only; tile blobs live in IndexedDB
  tileJobs:         {},

  // RUN 8
  tacho:            {},

  // RUN 10 — audit refs; live queue lives in SyncQueue adapter
  syncQueue:        {},
  syncConflicts:    {},

  // System
  events: []
};

export default store;
