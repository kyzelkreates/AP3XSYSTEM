// AP3X AI Master Controller — SSOT (RUN 2 EXTENDED)
// Single Source of Truth. No direct mutation from outside this module.
// All state mutations must go through entity managers and emit events.

export const store = {
  fleets: {},
  fleetBrands: {},
  deployments: {},
  drivers: {},
  vehicles: {},
  devices: {},
  identities: {},
  assignments: {},
  permissions: {},
  events: []
};

export default store;
