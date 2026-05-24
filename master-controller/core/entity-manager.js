// AP3X Entity Manager — base CRUD primitives for all entity types
// All entity managers build on top of these. Do NOT call directly from API layer.

import { emitEvent } from "./event-emitter.js";

/**
 * Generic entity factory.
 * @param {object} store - SSOT
 * @param {string} collection - key on store (e.g. "drivers")
 * @param {object} data - entity fields
 * @param {string} eventType - e.g. "driver.created"
 * @param {string} fleetId - fleet this entity belongs to
 */
export function createEntity(store, collection, data, eventType, fleetId) {
  if (!store[collection]) throw new Error(`Unknown entity collection: ${collection}`);

  const id = crypto.randomUUID();
  const record = {
    id,
    fleetId: fleetId || null,
    ...data,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  store[collection][id] = record;

  emitEvent(store, {
    type: eventType,
    fleetId: fleetId || null,
    entityId: id,
    collection,
    payload: record
  });

  return record;
}

/**
 * Generic entity update with event emission.
 */
export function updateEntity(store, collection, id, patch, eventType) {
  if (!store[collection]) throw new Error(`Unknown entity collection: ${collection}`);
  const existing = store[collection][id];
  if (!existing) throw new Error(`${collection} record not found: ${id}`);

  const updated = {
    ...existing,
    ...patch,
    updatedAt: Date.now()
  };

  store[collection][id] = updated;

  emitEvent(store, {
    type: eventType || `${collection}.updated`,
    fleetId: updated.fleetId || null,
    entityId: id,
    collection,
    payload: updated
  });

  return updated;
}

/**
 * Get a single entity record.
 */
export function getEntity(store, collection, id) {
  if (!store[collection]) throw new Error(`Unknown entity collection: ${collection}`);
  const record = store[collection][id];
  if (!record) throw new Error(`${collection} record not found: ${id}`);
  return record;
}

/**
 * List all records in a collection, optionally filtered by fleetId.
 */
export function listEntities(store, collection, fleetId = null) {
  if (!store[collection]) throw new Error(`Unknown entity collection: ${collection}`);
  const all = Object.values(store[collection]);
  return fleetId ? all.filter(r => r.fleetId === fleetId) : all;
}
