// AP3X Conflict Resolver — RUN 10
// Detects and resolves sync conflicts between client and server state.
// Strategy dispatch based on entity type → ENTITY_CONFLICT_STRATEGY map.
// Never throws. Always returns a ConflictResult.
// NO UI. NO routing. NO fleet logic changes.

import {
  CONFLICT_STRATEGY, ENTITY_CONFLICT_STRATEGY,
  MERGE_RULES, MAX_CLOCK_SKEW_MS, SYNC_OP
} from "./sync-constants.js";

// ─── CONFLICT DETECTION ───────────────────────────────────────────────────────

/**
 * Detect whether a sync item conflicts with current server state.
 *
 * A conflict exists when:
 *   1. Server version is newer than client's snapshot (updatedAt comparison)
 *   2. The same fields are modified on both sides (field-level diff)
 *   3. Clock skew exceeds MAX_CLOCK_SKEW_MS (ordering unreliable)
 *
 * @param {SyncItem}  item         - Queued sync item from client
 * @param {object}    serverRecord - Current server-side entity record
 * @returns {ConflictReport} { isConflict, reason, conflictingFields, clockSkew }
 */
export function detectConflict(item, serverRecord) {
  if (!serverRecord) {
    // No server record = no conflict — it's a create operation
    return { isConflict: false, reason: null, conflictingFields: [], clockSkew: 0 };
  }

  const clientTs = item.payload?.updatedAt || item.enqueuedAt;
  const serverTs = serverRecord.updatedAt  || serverRecord.lastUpdateTime || 0;
  const clockSkew = Math.abs(clientTs - Date.now());

  // ── 1. Clock skew ─────────────────────────────────────────────────────────
  if (clockSkew > MAX_CLOCK_SKEW_MS) {
    return {
      isConflict:       true,
      reason:           "clock_skew",
      conflictingFields:[],
      clockSkew,
      clientTs,
      serverTs
    };
  }

  // ── 2. Server is strictly newer ───────────────────────────────────────────
  if (serverTs > clientTs + 1000) {   // 1s grace window
    // Check whether any overlapping fields were modified
    const conflictingFields = _findConflictingFields(
      item.payload,
      serverRecord,
      item.entityType
    );

    return {
      isConflict:       conflictingFields.length > 0,
      reason:           conflictingFields.length > 0 ? "concurrent_write" : null,
      conflictingFields,
      clockSkew,
      clientTs,
      serverTs
    };
  }

  // ── 3. Vector clock ordering violation ────────────────────────────────────
  if (item.vectorClock && serverRecord.vectorClock) {
    const clientSeq = _parseVectorSeq(item.vectorClock);
    const serverSeq = _parseVectorSeq(serverRecord.vectorClock);
    if (serverSeq > clientSeq + 1) {
      return {
        isConflict:       true,
        reason:           "vector_clock_gap",
        conflictingFields:[],
        clockSkew,
        clientTs,
        serverTs,
        clientSeq,
        serverSeq
      };
    }
  }

  return { isConflict: false, reason: null, conflictingFields: [], clockSkew };
}

// ─── CONFLICT RESOLUTION ──────────────────────────────────────────────────────

/**
 * Resolve a detected conflict between a sync item and server state.
 * Returns the resolved record that should be applied to the server.
 *
 * @param {SyncItem}     item         - Client's intended change
 * @param {object}       serverRecord - Current server state
 * @param {ConflictReport} report     - From detectConflict()
 * @param {string}       [overrideStrategy] - Force a specific strategy
 * @returns {ConflictResult}
 *   { strategy, resolved, appliedFields, droppedFields, notes }
 */
export function resolveConflict(item, serverRecord, report, overrideStrategy) {
  const strategy = overrideStrategy
    || ENTITY_CONFLICT_STRATEGY[item.entityType]
    || CONFLICT_STRATEGY.SERVER_WINS;

  switch (strategy) {
    case CONFLICT_STRATEGY.SERVER_WINS:
      return _serverWins(item, serverRecord, report);

    case CONFLICT_STRATEGY.CLIENT_WINS:
      return _clientWins(item, serverRecord, report);

    case CONFLICT_STRATEGY.LAST_WRITE:
      return _lastWrite(item, serverRecord, report);

    case CONFLICT_STRATEGY.MERGE_FIELDS:
      return _mergeFields(item, serverRecord, report);

    case CONFLICT_STRATEGY.MANUAL:
      return _escalateManual(item, serverRecord, report);

    default:
      return _serverWins(item, serverRecord, report);
  }
}

// ─── STRATEGIES ───────────────────────────────────────────────────────────────

function _serverWins(item, serverRecord, report) {
  return {
    strategy:      CONFLICT_STRATEGY.SERVER_WINS,
    resolved:      { ...serverRecord },
    appliedFields: [],
    droppedFields: Object.keys(item.payload || {}),
    notes:         `Server wins — client changes discarded. Reason: ${report.reason || "server_newer"}`
  };
}

function _clientWins(item, serverRecord, report) {
  const resolved = { ...serverRecord, ...item.payload, updatedAt: Date.now() };
  return {
    strategy:      CONFLICT_STRATEGY.CLIENT_WINS,
    resolved,
    appliedFields: Object.keys(item.payload || {}),
    droppedFields: [],
    notes:         `Client wins — client payload applied over server state`
  };
}

function _lastWrite(item, serverRecord, report) {
  const clientTs = item.payload?.updatedAt || item.enqueuedAt;
  const serverTs = serverRecord.updatedAt  || 0;

  if (clientTs >= serverTs) {
    return _clientWins(item, serverRecord, report);
  } else {
    return _serverWins(item, serverRecord, report);
  }
}

function _mergeFields(item, serverRecord, report) {
  const rules        = MERGE_RULES[item.entityType];
  const resolved     = { ...serverRecord };
  const appliedFields= [];
  const droppedFields= [];
  const notes        = [];

  if (!rules) {
    // No merge rules defined — fall back to server wins for safety
    return _serverWins(item, serverRecord, report);
  }

  const payload = item.payload || {};

  // ── Additive fields: take max of client + server ──────────────────────────
  for (const field of (rules.additive || [])) {
    if (payload[field] != null) {
      const clientVal = Number(payload[field]) || 0;
      const serverVal = Number(serverRecord[field]) || 0;
      resolved[field] = Math.max(clientVal, serverVal);
      appliedFields.push(`${field}=max(${clientVal},${serverVal})->${resolved[field]}`);
    }
  }

  // ── Server-wins fields: keep server value ─────────────────────────────────
  for (const field of (rules.server_wins || [])) {
    if (payload[field] != null && serverRecord[field] != null) {
      resolved[field] = serverRecord[field];
      droppedFields.push(field);
    }
  }

  // ── Client-wins fields: take client value ─────────────────────────────────
  for (const field of (rules.client_wins || [])) {
    if (payload[field] != null) {
      resolved[field] = payload[field];
      appliedFields.push(field);
    }
  }

  // ── Timestamp fields: newer wins ──────────────────────────────────────────
  for (const field of (rules.timestamp || [])) {
    const clientVal = payload[field];
    const serverVal = serverRecord[field];
    if (clientVal != null && serverVal != null) {
      resolved[field] = Math.max(Number(clientVal), Number(serverVal));
      appliedFields.push(`${field}=newer`);
    } else if (clientVal != null) {
      resolved[field] = clientVal;
      appliedFields.push(field);
    }
  }

  // Stamp merged record
  resolved.updatedAt    = Date.now();
  resolved.vectorClock  = item.vectorClock;
  notes.push(`Merged ${appliedFields.length} fields, dropped ${droppedFields.length} fields`);

  return {
    strategy:      CONFLICT_STRATEGY.MERGE_FIELDS,
    resolved,
    appliedFields,
    droppedFields,
    notes:         notes.join(". ")
  };
}

function _escalateManual(item, serverRecord, report) {
  // Future: push to fleet admin conflict queue
  return {
    strategy:      CONFLICT_STRATEGY.MANUAL,
    resolved:      { ...serverRecord }, // hold server state until admin resolves
    appliedFields: [],
    droppedFields: Object.keys(item.payload || {}),
    notes:         `Manual resolution required — escalated. Conflict: ${report.reason}`
  };
}

// ─── BULK CONFLICT SCAN ───────────────────────────────────────────────────────

/**
 * Scan a set of queued items against a server state snapshot.
 * Returns an array of { item, report, resolution } for all conflicts found.
 *
 * @param {SyncItem[]} items        - All pending sync items
 * @param {Map}        serverSnap   - Map<entityId, serverRecord>
 * @returns {ConflictScanResult[]}
 */
export function scanForConflicts(items, serverSnap) {
  const results = [];

  for (const item of items) {
    const serverRecord = serverSnap.get(item.entityId);
    const report       = detectConflict(item, serverRecord);

    if (report.isConflict) {
      const resolution = resolveConflict(item, serverRecord, report);
      results.push({ item, report, resolution });
    }
  }

  return results;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _findConflictingFields(payload, serverRecord, entityType) {
  const conflicts  = [];
  const rules      = MERGE_RULES[entityType];
  const watchFields= [
    ...(rules?.additive    || []),
    ...(rules?.server_wins || []),
    ...(rules?.client_wins || []),
    ...(rules?.timestamp   || [])
  ];

  for (const field of watchFields) {
    if (
      payload?.[field] !== undefined &&
      serverRecord?.[field] !== undefined &&
      payload[field] !== serverRecord[field]
    ) {
      conflicts.push(field);
    }
  }

  // Also check generic field overlap when no explicit rules
  if (watchFields.length === 0 && payload) {
    for (const key of Object.keys(payload)) {
      if (serverRecord[key] !== undefined && serverRecord[key] !== payload[key]) {
        conflicts.push(key);
      }
    }
  }

  return conflicts;
}

function _parseVectorSeq(vectorClock) {
  if (!vectorClock) return 0;
  const parts = vectorClock.split(":");
  return parseInt(parts[parts.length - 1]) || 0;
}
