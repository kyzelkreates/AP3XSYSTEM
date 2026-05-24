// AP3X Sync Manager — RUN 10 (ORCHESTRATOR)
// ═══════════════════════════════════════════════════════════════════════════════
// Central sync orchestrator. Manages the full sync lifecycle:
//   1. Enqueue outbound operations from any module
//   2. Drain queue with retry + backoff
//   3. Pull server state and reconcile
//   4. Detect and resolve conflicts
//   5. Emit structured events for every state transition
//
// Usage (server):  new SyncManager({ store, transport, adapter: MemoryAdapter })
// Usage (device):  new SyncManager({ store, transport, adapter: IndexedDBAdapter })
//
// NO UI. NO routing. NO fleet logic changes.
// ═══════════════════════════════════════════════════════════════════════════════

import { emitEvent }      from "../event-emitter.js";
import {
  SYNC_STATUS, SYNC_OP, SYNC_ENTITY, SYNC_DIRECTION,
  RETRY, PRIORITY
} from "./sync-constants.js";
import {
  SyncQueue, MemoryAdapter, IndexedDBAdapter,
  createSyncItem
} from "./sync-queue.js";
import { detectConflict, resolveConflict, scanForConflicts } from "./conflict-resolver.js";
import {
  reconcileEntity, reconcileSnapshot, reconcileTachoAccum,
  reconcileHazard, applyPlan, applyBatch, buildOfflineMergePipeline
} from "./reconciler.js";

// ─── SYNC MANAGER ─────────────────────────────────────────────────────────────

export class SyncManager {
  /**
   * @param {object} options
   * @param {object}   options.store        - AP3X SSOT
   * @param {object}   options.transport    - { push(items), pull(context), ack(id) }
   * @param {Function} [options.adapter]    - Queue storage adapter constructor
   * @param {object}   [options.context]    - { deviceId, driverId, fleetId }
   * @param {boolean}  [options.autoStart]  - Start drain loop immediately (default: true)
   */
  constructor(options = {}) {
    this._store     = options.store     || {};
    this._transport = options.transport || _noopTransport();
    this._context   = options.context   || {};
    this._queue     = new SyncQueue(
      options.adapter
        ? new options.adapter()
        : new MemoryAdapter()
    );

    this._drainTimer    = null;
    this._pullTimer     = null;
    this._online        = true;
    this._draining      = false;
    this._pullInterval  = options.pullIntervalMs || 30_000;
    this._drainInterval = options.drainIntervalMs || 5_000;

    if (options.autoStart !== false) this.start();
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  start() {
    this._drainTimer = setInterval(() => this._drainCycle(), this._drainInterval);
    this._pullTimer  = setInterval(() => this._pullCycle(),  this._pullInterval);
    this._emitEvent("sync.manager.started", { context: this._context });
  }

  stop() {
    if (this._drainTimer) clearInterval(this._drainTimer);
    if (this._pullTimer)  clearInterval(this._pullTimer);
    this._emitEvent("sync.manager.stopped", {});
  }

  setOnline(online) {
    const changed = this._online !== online;
    this._online  = online;
    if (changed) {
      this._emitEvent(online ? "sync.online" : "sync.offline", {});
      if (online) {
        // Reconnected — drain immediately and pull
        this._drainCycle();
        this._pullCycle();
      }
    }
  }

  // ─── ENQUEUE ───────────────────────────────────────────────────────────────

  /**
   * Enqueue an outbound sync operation.
   * Safe to call from any module at any time.
   *
   * @param {string} op          - SYNC_OP.*
   * @param {string} entityType  - SYNC_ENTITY.*
   * @param {string} entityId    - Entity ID
   * @param {object} payload     - Operation payload
   * @returns {SyncItem}
   */
  async enqueue(op, entityType, entityId, payload) {
    const item = createSyncItem(op, entityType, entityId, payload, this._context);
    await this._queue.enqueue(item);

    this._emitEvent("sync.enqueued", {
      id:         item.id,
      op,
      entityType,
      entityId,
      priority:   item.priority,
      queuedAt:   item.enqueuedAt
    });

    // Trigger drain if online
    if (this._online && !this._draining) {
      setTimeout(() => this._drainCycle(), 0);
    }

    return item;
  }

  // Convenience wrappers for common operations

  async enqueueTachoActivity(driverId, activityType, accum) {
    return this.enqueue(
      SYNC_OP.TACHO_ACTIVITY, SYNC_ENTITY.TACHO, driverId,
      { driverId, activityType, accum, updatedAt: Date.now() }
    );
  }

  async enqueueHazardReport(fleetId, hazardId, report) {
    return this.enqueue(
      SYNC_OP.HAZARD_REPORT, SYNC_ENTITY.HAZARD, hazardId,
      { fleetId, hazardId, ...report, updatedAt: Date.now() }
    );
  }

  async enqueueDropReached(routeId, dropIndex, arrivedAt) {
    return this.enqueue(
      SYNC_OP.NAV_DROP_REACHED, SYNC_ENTITY.NAV, routeId,
      { routeId, dropIndex, arrivedAt, updatedAt: arrivedAt }
    );
  }

  async enqueuePositionUpdate(routeId, position) {
    return this.enqueue(
      SYNC_OP.NAV_POSITION_UPDATE, SYNC_ENTITY.NAV, routeId,
      { routeId, ...position, updatedAt: Date.now() }
    );
  }

  async enqueueHeartbeat(deviceId) {
    return this.enqueue(
      SYNC_OP.DEVICE_HEARTBEAT, SYNC_ENTITY.DEVICE, deviceId,
      { deviceId, ...this._context, timestamp: Date.now() }
    );
  }

  // ─── DRAIN CYCLE ───────────────────────────────────────────────────────────

  async _drainCycle() {
    if (!this._online || this._draining) return;
    this._draining = true;

    try {
      const items = await this._queue.getReadyItems(RETRY.QUEUE_CONCURRENCY);
      if (items.length === 0) return;

      this._emitEvent("sync.drain.start", { count: items.length });

      // Mark all in-flight simultaneously
      await Promise.all(items.map(i => this._queue.markInFlight(i.id)));

      // Send in parallel with concurrency cap
      const results = await Promise.allSettled(
        items.map(item => this._sendItem(item))
      );

      let sent = 0, failed = 0, conflicted = 0;

      for (let i = 0; i < items.length; i++) {
        const result = results[i];
        const item   = items[i];

        if (result.status === "fulfilled") {
          const { ack, conflict, serverState } = result.value;

          if (conflict) {
            await this._handleConflict(item, serverState);
            conflicted++;
          } else {
            await this._queue.markComplete(item.id, ack);
            this._emitEvent("sync.item.sent", { id: item.id, op: item.op, entityId: item.entityId });
            sent++;
          }
        } else {
          await this._queue.markFailed(item.id, result.reason?.message || "unknown");
          this._emitEvent("sync.item.failed", {
            id:       item.id,
            op:       item.op,
            error:    result.reason?.message,
            attempts: item.attempts
          });
          failed++;
        }
      }

      this._emitEvent("sync.drain.complete", { sent, failed, conflicted });

      // Purge old completed items
      const purged = await this._queue.purgeCompleted();
      if (purged > 0) this._emitEvent("sync.purged", { count: purged });

    } finally {
      this._draining = false;
    }
  }

  // ─── SEND ITEM ─────────────────────────────────────────────────────────────

  async _sendItem(item) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), RETRY.TIMEOUT_MS);

    try {
      const result = await this._transport.push([item], { signal: controller.signal });
      return result || { ack: null, conflict: false };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── CONFLICT HANDLER ──────────────────────────────────────────────────────

  async _handleConflict(item, serverState) {
    await this._queue.markConflict(item.id, serverState);

    const report     = detectConflict(item, serverState);
    const resolution = resolveConflict(item, serverState, report);

    this._emitEvent("sync.conflict.detected", {
      id:           item.id,
      op:           item.op,
      entityType:   item.entityType,
      entityId:     item.entityId,
      reason:       report.reason,
      strategy:     resolution.strategy,
      appliedFields:resolution.appliedFields,
      droppedFields:resolution.droppedFields
    });

    // Apply resolved state to local store
    const collection = _entityTypeToCollection(item.entityType);
    if (collection && resolution.resolved) {
      if (!this._store[collection]) this._store[collection] = {};
      this._store[collection][item.entityId] = {
        ...resolution.resolved,
        reconciledAt: Date.now()
      };

      this._emitEvent("sync.conflict.resolved", {
        id:         item.id,
        entityId:   item.entityId,
        strategy:   resolution.strategy,
        collection
      });
    }

    // Mark as complete after resolution
    await this._queue.markComplete(item.id, "conflict_resolved");
  }

  // ─── PULL CYCLE ────────────────────────────────────────────────────────────

  async _pullCycle() {
    if (!this._online) return;

    try {
      const serverData = await this._transport.pull(this._context);
      if (!serverData) return;

      this._emitEvent("sync.pull.received", {
        collections: Object.keys(serverData)
      });

      await this._processPullData(serverData);

    } catch (err) {
      this._emitEvent("sync.pull.failed", { error: err.message });
    }
  }

  async _processPullData(serverData) {
    const RECONCILABLE = ["routes", "hazards", "tacho", "drivers", "devices"];

    for (const col of RECONCILABLE) {
      if (!serverData[col]) continue;

      const serverMap = new Map(Object.entries(serverData[col]));
      const clientMap = new Map(Object.entries(this._store[col] || {}));
      const batch     = reconcileSnapshot(_colToEntityType(col), clientMap, serverMap);

      applyBatch(batch, this._store, col);

      this._emitEvent("sync.reconcile.complete", {
        collection: col,
        ...batch.stats
      });
    }
  }

  // ─── OFFLINE → ONLINE MERGE ────────────────────────────────────────────────

  /**
   * Full offline → online merge.
   * Call when device reconnects after extended offline period.
   * Pulls server state, builds reconciliation pipeline, applies all plans.
   *
   * @param {string[]} [collections] - Which collections to merge (default: all)
   * @returns {MergeResult}
   */
  async mergeOfflineState(collections = ["routes", "hazards", "tacho", "drivers", "devices"]) {
    this._emitEvent("sync.merge.started", { collections });

    let serverStore;
    try {
      serverStore = await this._transport.pull(this._context);
    } catch (err) {
      this._emitEvent("sync.merge.failed", { error: err.message });
      throw err;
    }

    const pipeline = buildOfflineMergePipeline(this._store, serverStore, collections);

    for (const [col, batch] of Object.entries(pipeline.batches)) {
      const result = applyBatch(batch, this._store, col);
      this._emitEvent("sync.merge.collection", {
        collection: col,
        ...batch.stats,
        ...result
      });
    }

    // After merge, drain pending queue
    await this._drainCycle();

    this._emitEvent("sync.merge.complete", {
      totalConflicts: pipeline.totalConflicts,
      totalApplied:   pipeline.totalApplied,
      reconciledAt:   pipeline.reconciledAt
    });

    return pipeline;
  }

  // ─── QUEUE STATS ───────────────────────────────────────────────────────────

  async getQueueStats() {
    return this._queue.getStats();
  }

  async getPendingItems() {
    const all = await this._queue.getAll();
    return all.filter(i => i.status === SYNC_STATUS.PENDING || i.status === SYNC_STATUS.FAILED);
  }

  async getConflicts() {
    const all = await this._queue.getAll();
    return all.filter(i => i.status === SYNC_STATUS.CONFLICT);
  }

  // ─── EVENT EMITTER ─────────────────────────────────────────────────────────

  _emitEvent(type, payload) {
    if (this._store?.events !== undefined) {
      emitEvent(this._store, { type, collection: "sync", entityId: null, payload });
    }
    // Also dispatch as browser event if available (PWA context)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(`ap3x:${type}`, { detail: payload }));
    }
  }
}

// ─── FACTORY HELPERS ─────────────────────────────────────────────────────────

/**
 * Create a server-side SyncManager (in-memory, no adapter).
 */
export function createServerSyncManager(store, transport, context) {
  return new SyncManager({
    store, transport, context,
    adapter:          MemoryAdapter,
    pullIntervalMs:   60_000,
    drainIntervalMs:  2_000,
    autoStart:        true
  });
}

/**
 * Create a device-side SyncManager (IndexedDB backed).
 */
export function createDeviceSyncManager(store, transport, context) {
  return new SyncManager({
    store, transport, context,
    adapter:          IndexedDBAdapter,
    pullIntervalMs:   30_000,
    drainIntervalMs:  5_000,
    autoStart:        true
  });
}

// ─── NOOP TRANSPORT ──────────────────────────────────────────────────────────

function _noopTransport() {
  return {
    push: async () => ({ ack: null, conflict: false }),
    pull: async () => null
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _entityTypeToCollection(entityType) {
  const map = {
    route:  "routes",
    hazard: "hazards",
    tacho:  "tacho",
    driver: "drivers",
    device: "devices",
    nav:    "routes"
  };
  return map[entityType] || null;
}

function _colToEntityType(col) {
  const map = {
    routes:  "route",
    hazards: "hazard",
    tacho:   "tacho",
    drivers: "driver",
    devices: "device"
  };
  return map[col] || col;
}
