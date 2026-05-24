// AP3X Permission Engine — RUN 2
// RULE 4: Permissions are DERIVED — not manually overridden.
// Roles are additive. No permission patching. Future runs extend this schema only.

import { emitEvent } from "./event-emitter.js";

// ─── Role permission matrix ────────────────────────────────────────────────
const ROLE_PERMISSIONS = {
  master: ["*"],                          // full control — AP3X control plane only

  fleetAdmin: [
    "fleet.read",
    "fleet.update",
    "driver.manage",
    "vehicle.manage",
    "device.manage",
    "identity.manage",
    "deployment.read",
    "deployment.trigger",
    "route.manage"                        // stub — enforced in RUN 4+
  ],

  fleetOperator: [
    "fleet.read",
    "driver.read",
    "vehicle.read",
    "device.read",
    "deployment.read"
  ],

  driver: [
    "route.read",                         // stub — enforced in RUN 4+
    "route.execute",                      // stub — enforced in RUN 4+
    "hazard.report",                      // stub — enforced in RUN 5+
    "tacho.write"                         // stub — enforced in RUN 7+
  ]
};

// ─── Wildcards & permission check ─────────────────────────────────────────

/**
 * Get all permissions for a given role.
 * Returns ["*"] for master — callers must handle wildcard.
 */
export function getPermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Check whether a role has a specific permission.
 */
export function hasPermission(role, permission) {
  const perms = getPermissions(role);
  if (perms.includes("*")) return true;
  return perms.includes(permission);
}

/**
 * Assign a role to a driver identity in the store.
 * Emits permission.assigned event.
 */
export function assignPermission(store, fleetId, driverId, role) {
  if (!ROLE_PERMISSIONS[role]) throw new Error(`Unknown role: ${role}`);

  const driver = store.drivers[driverId];
  if (!driver) throw new Error("Driver not found");
  if (driver.fleetId !== fleetId) throw new Error("Driver does not belong to this fleet");

  const permKey = `${fleetId}:${driverId}`;
  store.permissions[permKey] = {
    fleetId,
    driverId,
    role,
    permissions: getPermissions(role),
    assignedAt: Date.now()
  };

  emitEvent(store, {
    type: "permission.assigned",
    fleetId,
    entityId: driverId,
    collection: "permissions",
    payload: store.permissions[permKey]
  });

  return store.permissions[permKey];
}

/**
 * Resolve the effective permissions for a driver in a fleet.
 */
export function resolvePermissions(store, fleetId, driverId) {
  const permKey = `${fleetId}:${driverId}`;
  return store.permissions[permKey] || null;
}

/**
 * List all permission assignments for a fleet.
 */
export function listPermissions(store, fleetId) {
  return Object.values(store.permissions).filter(p => p.fleetId === fleetId);
}
