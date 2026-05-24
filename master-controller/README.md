# AP3X Master Controller

Multi-fleet management control plane. Vercel-hosted. Offline-first driver PWA. Full EU 561/2006 tachograph compliance.

---

## Architecture

```
ap3x-master-controller/
├── api/                        # Vercel serverless functions
│   ├── createFleet.js          # POST /api/createFleet
│   ├── updateFleet.js          # POST /api/updateFleet
│   ├── deployFleet.js          # POST /api/deployFleet
│   ├── safetyCheck.js          # POST /api/safetyCheck
│   ├── hazard/
│   │   ├── report.js           # POST /api/hazard/report
│   │   ├── confirm.js          # POST /api/hazard/confirm
│   │   └── dispute.js          # POST /api/hazard/dispute
│   ├── tacho/
│   │   ├── activity.js         # POST /api/tacho/activity
│   │   └── session.js          # POST /api/tacho/session
│   ├── driver/
│   │   └── sync.js             # GET  /api/driver/sync
│   └── device/
│       ├── heartbeat.js        # POST /api/device/heartbeat
│       └── checkin.js          # POST /api/device/checkin
│
├── core/                       # Business logic — no HTTP concerns
│   ├── storage.js              # SSOT — single source of truth
│   ├── event-emitter.js        # All actions emit events
│   ├── fleet-manager.js        # Fleet lifecycle
│   ├── driver-manager.js       # Driver management
│   ├── vehicle-manager.js      # Vehicle management
│   ├── device-manager.js       # Device provisioning
│   ├── entity-manager.js       # Generic entity CRUD
│   ├── identity-binder.js      # Driver ↔ vehicle ↔ device binding
│   ├── permission-engine.js    # Role-based permissions
│   ├── branding-engine.js      # Fleet branding config
│   ├── deployment-orchestrator.js
│   ├── compliance/
│   │   ├── compliance-constants.js   # EU 561 + UK domestic thresholds
│   │   ├── compliance-validator.js   # Pre-route compliance gate
│   │   └── tachograph-engine.js      # Live session tracking
│   ├── hazards/
│   │   ├── hazard-constants.js
│   │   ├── hazard-manager.js
│   │   ├── hazard-broadcast.js
│   │   └── hazard-validator.js
│   ├── integrations/
│   │   ├── graphhopper.js            # GraphHopper routing API
│   │   └── osm-fallback.js           # OSM straight-line fallback
│   ├── observability/
│   │   ├── obs-constants.js
│   │   ├── event-log.js              # Query, replay, timeline
│   │   └── compliance-exporter.js    # JSON/CSV/NDJSON exports
│   ├── routing/
│   │   ├── route-builder.js
│   │   ├── route-engine.js
│   │   ├── route-validator.js
│   │   └── vehicle-constraints.js
│   ├── safety/
│   │   ├── safety-constants.js
│   │   ├── safety-engine.js          # Safety AI gatekeeper
│   │   └── risk-scorer.js
│   ├── sync/
│   │   ├── sync-constants.js
│   │   ├── sync-queue.js             # Priority queue + adapters
│   │   ├── conflict-resolver.js      # 5 conflict strategies
│   │   ├── reconciler.js             # Offline→online merge
│   │   └── sync-manager.js           # Orchestrator
│   └── tiles/
│       ├── tile-constants.js
│       ├── tile-manager.js           # Tile prefetch + cache
│       └── tile-store.js             # IndexedDB tile storage
│
├── pwa/                        # Offline-first driver application
│   ├── index.html              # App shell (installable PWA)
│   ├── manifest.json           # PWA manifest
│   ├── sw.js                   # Service worker
│   ├── css/driver.css
│   └── js/
│       ├── app.js              # Shell orchestrator
│       ├── offline-nav.js      # Navigation state machine
│       ├── route-viewer.js     # Drop sequence UI
│       ├── hazard-reporter.js  # Hazard display + reporting
│       ├── tacho-logger.js     # Compliance UI + activity logging
│       └── sync-agent.js       # Bidirectional sync + IndexedDB queue
│
├── ui/                         # Fleet admin interfaces
│   ├── dashboard.html          # Fleet overview
│   ├── fleet-create.html       # Fleet provisioning wizard
│   ├── fleet-detail.html       # Fleet detail + management
│   ├── fleet-os.html           # Fleet OS operational dashboard
│   ├── audit-dashboard.html    # Observability + compliance
│   └── event-timeline.html     # Event replay viewer
│
├── config/
│   └── vercel.json             # Build + routing config
├── package.json
└── README.md
```

---

## Runs Completed

| Run | System | Files |
|-----|--------|-------|
| 1   | Master Controller — fleet, deploy, entity, identity, permissions, branding | 15 |
| 2   | Entity system — drivers, vehicles, devices, identity binding | +8 |
| 4   | Routing engine — GraphHopper + OSM fallback, route builder + validator | +6 |
| 5   | Safety AI gatekeeper — risk scorer, safety engine, safety constants | +3 |
| 6   | Hazard system — manager, broadcast, validator, constants | +4 |
| 7   | Tile cache — tile-manager, tile-store, tile-constants | +3 |
| 8   | Tachograph engine — EU 561 + UK domestic compliance | +3 |
| 9   | Driver PWA — offline-first installable app, service worker, 5 modules | +10 |
| 10  | Sync engine — queue, conflict resolver, reconciler, orchestrator | +5 |
| 11  | Observability — event log, compliance exporter, audit dashboard, timeline | +5 |
| 12  | Completion — 8 API handlers, Vercel config, package.json, README | +11 |

**Total: 73 files**

---

## API Reference

### Fleet Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/createFleet` | Create a new fleet |
| POST | `/api/updateFleet` | Update fleet branding |
| POST | `/api/deployFleet` | Deploy fleet to operational state |
| POST | `/api/safetyCheck` | Run safety gate on a route |

### Hazard
| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/hazard/report` | `{ fleetId, report: { type, lat, lon, severity? } }` |
| POST | `/api/hazard/confirm` | `{ hazardId, driverId, fleetId }` |
| POST | `/api/hazard/dispute` | `{ hazardId, driverId, fleetId }` |

### Tachograph
| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/tacho/session` | `{ action: "start"\|"end", driverId, vehicleId, fleetId }` |
| POST | `/api/tacho/activity` | `{ driverId, fleetId, activityType, time? }` |

Activity types: `driving`, `break`, `rest`, `other_work`, `available`

### Driver Sync
| Method | Endpoint | Query |
|--------|----------|-------|
| GET | `/api/driver/sync` | `?driverId=&fleetId=&deviceId=` |

Returns: `{ route, hazardBroadcasts, complianceSnapshot, safetyDecision }`

### Device
| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/device/checkin` | `{ deviceId, driverId, fleetId, userAgent? }` |
| POST | `/api/device/heartbeat` | `{ deviceId, driverId, fleetId, timestamp? }` |

---

## Compliance

Regulation sets supported:

**EU 561/2006**
- 4h 30m continuous driving max, 45min break (or 15+30 split)
- 9h standard / 10h extended (max 2×/week) daily driving
- 56h weekly driving limit, 90h fortnightly limit
- 11h standard / 9h reduced (max 3×/week) daily rest
- 45h regular / 24h reduced weekly rest

**UK Domestic**
- 10h daily driving, 14h on-duty spread, 5h 30m before break
- 10h off-duty between shifts, 24h weekly rest

Regulation auto-selected from vehicle weight class.

---

## PWA — Driver App

Install at `/pwa/index.html`. Works fully offline after first load.

**Provisioning flow:**
1. Fleet admin deploys a driver → gets a deep link: `/pwa/index.html?driverId=DRV-xxx&fleetId=FLT-xxx&deviceId=DEV-xxx`
2. Driver opens link → PWA installs → identity saved to IndexedDB
3. Device checks in via `/api/device/checkin`
4. Sync agent starts pulling route + hazards + compliance snapshot
5. Driver works offline — all activity queued in IndexedDB → replayed on reconnect

**Views:**
- 🗺️ Route — drop sequence, ETA, tile readiness, arrived / pause / end controls
- ⚠️ Hazard — fleet broadcasts, driver report form with geolocation
- ⏱ Hours — tachograph timer, EU 561 progress bars, violation alerts
- 📡 Status — device identity, sync queue, SW status, force sync

---

## Deployment

```bash
cd master-controller
npm install
vercel --prod
```

Environment variables (set in Vercel dashboard):
- `GRAPHHOPPER_API_KEY` — GraphHopper routing API key
- `AP3X_FLEET_SECRET` — internal signing secret

---

## SSOT Keys

```
store.fleets            store.fleetBrands       store.deployments
store.drivers           store.vehicles          store.devices
store.identities        store.assignments       store.permissions
store.routes            store.safetyDecisions
store.hazards           store.hazardBroadcasts
store.tileJobs          (tile blobs in IndexedDB)
store.tacho
store.syncQueue         store.syncConflicts
store.events            (append-only, read by observability)
```
