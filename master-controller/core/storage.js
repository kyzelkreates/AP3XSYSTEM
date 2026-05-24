// AP3X AI Master Controller — SSOT (RUN 5 EXTENDED)
// Single Source of Truth. No direct mutation from outside this module.
// All state mutations must go through entity managers and emit events.
//
// RUN 1: fleets, fleetBrands, deployments, events
// RUN 2: drivers, vehicles, devices, identities, assignments, permissions
// RUN 4: routes
// RUN 5: safetyDecisions

export const store = {
  // RUN 1
  fleets:          {},
  fleetBrands:     {},
  deployments:     {},

  // RUN 2
  drivers:         {},
  vehicles:        {},
  devices:         {},
  identities:      {},
  assignments:     {},
  permissions:     {},

  // RUN 4
  routes:          {},

  // RUN 5
  safetyDecisions: {},

  // System
  events: []
};

export default store;
