// AP3X Tachograph Engine — RUN 8
// ═══════════════════════════════════════════════════════════════════════════════
// Tracks driver activity periods, accumulates driving/break/rest time,
// and maintains a per-driver compliance ledger in the SSOT.
// Emits events for every state transition and violation trigger.
//
// SCOPE: Rule engine + tracking only.
// NO enforcement UI. NO AI camera. NO route changes.
// Statutory ref: EU Regulation 561/2006 + UK domestic rules.
// ═══════════════════════════════════════════════════════════════════════════════

import { emitEvent } from "../event-emitter.js";
import {
  EU_561, UK_DOMESTIC, WELFARE,
  ACTIVITY, SESSION_STATUS, VIOLATION,
  VIOLATION_SEVERITY, VEHICLE_REGULATION_MAP, REGULATION
} from "./compliance-constants.js";

// ─── SESSION MANAGEMENT ──────────────────────────────────────────────────────

/**
 * Start a new driving session for a driver.
 * One session = one shift (start of duty → end of rest).
 *
 * @param {object} store
 * @param {string} fleetId
 * @param {string} driverId
 * @param {object} options - { vehicleId?, routeId?, startTime? }
 * @returns {Session}
 */
export function startSession(store, fleetId, driverId, options = {}) {
  _assertDriver(store, fleetId, driverId);

  if (!store.tacho) store.tacho = {};

  // Check for already-active session
  const existing = _getActiveSession(store, driverId);
  if (existing) {
    throw new Error(`Driver ${driverId} already has an active session: ${existing.id}`);
  }

  const sessionId = crypto.randomUUID();
  const now       = options.startTime || Date.now();

  const driver  = store.drivers[driverId];
  const vehicle = options.vehicleId ? store.vehicles[options.vehicleId] : null;
  const regulation = _resolveRegulation(vehicle);

  const session = {
    id:             sessionId,
    fleetId,
    driverId,
    vehicleId:      options.vehicleId || null,
    routeId:        options.routeId   || null,
    regulation,
    status:         SESSION_STATUS.ACTIVE,

    // Time accumulators (minutes)
    accum: {
      continuousDriveMin: 0,    // since last break
      todayDriveMin:      0,    // total driving today
      weekDriveMin:       0,    // total driving this week (rolling)
      fortDriveMin:       0,    // total driving this fortnight (rolling)
      todayRestMin:       0,    // rest accumulated today
      shiftMin:           0,    // total shift duration so far
      breakMin:           0,    // total break time today
      extendedDaysUsed:   0,    // count of extended 10h days used this week
      reducedRestDaysUsed:0     // count of reduced rest days used this week
    },

    // Activity log
    activities: [],             // { type, startTime, endTime, durationMin }
    currentActivity: null,      // { type, startTime }

    // Violation log
    violations: [],

    // Welfare flags (live state)
    welfare: {
      fatigueWarning:  false,
      fatigueAlert:    false,
      fuelAdvisory:    false,
      fuelCritical:    false
    },

    // Timestamps
    startTime:      now,
    lastUpdateTime: now,
    endTime:        null
  };

  store.tacho[sessionId] = session;

  // Start with DRIVING as default first activity
  _beginActivity(session, ACTIVITY.DRIVING, now);

  emitEvent(store, {
    type:      "tacho.session.started",
    fleetId,
    entityId:  sessionId,
    collection:"tacho",
    payload:   { sessionId, driverId, vehicleId: session.vehicleId, regulation, startTime: now }
  });

  return session;
}

/**
 * End a driving session. Closes current activity and runs final compliance check.
 */
export function endSession(store, fleetId, driverId, options = {}) {
  const session = _requireActiveSession(store, fleetId, driverId);
  const now     = options.endTime || Date.now();

  _closeActivity(session, now);
  session.status  = SESSION_STATUS.COMPLETE;
  session.endTime = now;

  emitEvent(store, {
    type:      "tacho.session.ended",
    fleetId,
    entityId:  session.id,
    collection:"tacho",
    payload: {
      sessionId:    session.id,
      driverId,
      shiftMin:     session.accum.shiftMin,
      driveMin:     session.accum.todayDriveMin,
      breakMin:     session.accum.breakMin,
      violationCount:session.violations.length
    }
  });

  return session;
}

// ─── ACTIVITY RECORDING ───────────────────────────────────────────────────────

/**
 * Record that a driver has started a different activity type.
 * Closes the current activity, opens the new one, runs compliance checks.
 *
 * @param {string} activityType - ACTIVITY.*
 * @param {object} options      - { time?, distanceKm? }
 */
export function recordActivity(store, fleetId, driverId, activityType, options = {}) {
  const session = _requireActiveSession(store, fleetId, driverId);
  const now     = options.time || Date.now();

  if (!Object.values(ACTIVITY).includes(activityType)) {
    throw new Error(`Unknown activity type: ${activityType}`);
  }

  // Close current, open new
  _closeActivity(session, now);
  _beginActivity(session, activityType, now);

  // Run compliance checks after every activity transition
  const violations = _runComplianceChecks(store, session, now, options.distanceKm);

  if (violations.length > 0) {
    violations.forEach(v => {
      emitEvent(store, {
        type:      "tacho.violation",
        fleetId,
        entityId:  session.id,
        collection:"tacho",
        payload:   { sessionId: session.id, driverId, violation: v }
      });
    });
  }

  emitEvent(store, {
    type:      "tacho.activity.recorded",
    fleetId,
    entityId:  session.id,
    collection:"tacho",
    payload: {
      sessionId:    session.id,
      driverId,
      activityType,
      time:         now,
      accum:        { ...session.accum }
    }
  });

  return { session, violations };
}

// ─── WELFARE CHECKS ───────────────────────────────────────────────────────────

/**
 * Run welfare checks independent of activity transitions.
 * Can be called on a schedule (every 15 min) from the control plane.
 */
export function runWelfareCheck(store, fleetId, driverId, options = {}) {
  const session = _requireActiveSession(store, fleetId, driverId);
  const now     = options.time || Date.now();
  const distKm  = options.distanceKm || 0;

  // Update current activity duration first
  if (session.currentActivity) {
    const elapsedMin = (now - session.currentActivity.startTime) / 60000;
    _accumulateActivity(session, session.currentActivity.type, elapsedMin);
  }

  return _runComplianceChecks(store, session, now, distKm);
}

// ─── READ INTERFACE ───────────────────────────────────────────────────────────

export function getSession(store, sessionId) {
  const s = store.tacho?.[sessionId];
  if (!s) throw new Error(`Tachograph session not found: ${sessionId}`);
  return s;
}

export function getActiveSession(store, driverId) {
  return _getActiveSession(store, driverId);
}

export function getDriverSessions(store, driverId) {
  return Object.values(store.tacho || {})
    .filter(s => s.driverId === driverId)
    .sort((a, b) => b.startTime - a.startTime);
}

export function getFleetSessions(store, fleetId, { activeOnly = false } = {}) {
  const sessions = Object.values(store.tacho || {})
    .filter(s => s.fleetId === fleetId);
  return activeOnly ? sessions.filter(s => s.status === SESSION_STATUS.ACTIVE) : sessions;
}

/**
 * Get a driver's current compliance snapshot — safe to surface to dashboard.
 */
export function getComplianceSnapshot(store, driverId) {
  const session = _getActiveSession(store, driverId);
  if (!session) return { active: false, driverId };

  const reg = session.regulation;
  const a   = session.accum;
  const limits = reg === REGULATION.EU_561 ? EU_561 : UK_DOMESTIC;

  return {
    active:     true,
    driverId,
    sessionId:  session.id,
    regulation: reg,
    status:     session.status,
    accum:      { ...a },
    welfare:    { ...session.welfare },
    limits: {
      dailyDriveMax:      reg === REGULATION.EU_561
                            ? EU_561.DAILY_DRIVE_STANDARD_MIN
                            : UK_DOMESTIC.DAILY_DRIVE_MAX_MIN,
      continuousDriveMax: reg === REGULATION.EU_561
                            ? EU_561.CONTINUOUS_DRIVE_MAX_MIN
                            : UK_DOMESTIC.BREAK_AFTER_MIN,
      breakRequired:      reg === REGULATION.EU_561
                            ? EU_561.BREAK_DURATION_MIN
                            : UK_DOMESTIC.BREAK_DURATION_MIN
    },
    violationCount:  session.violations.length,
    recentViolations:session.violations.slice(-5),
    currentActivity: session.currentActivity?.type || null,
    shiftStartTime:  session.startTime
  };
}

// ─── INTERNAL: ACTIVITY ───────────────────────────────────────────────────────

function _beginActivity(session, type, startTime) {
  session.currentActivity = { type, startTime };
  session.lastUpdateTime  = startTime;
}

function _closeActivity(session, endTime) {
  if (!session.currentActivity) return;

  const { type, startTime } = session.currentActivity;
  const durationMin = Math.max(0, (endTime - startTime) / 60000);

  session.activities.push({
    type,
    startTime,
    endTime,
    durationMin: parseFloat(durationMin.toFixed(2))
  });

  _accumulateActivity(session, type, durationMin);
  session.currentActivity = null;
}

function _accumulateActivity(session, type, durationMin) {
  const a = session.accum;

  switch (type) {
    case ACTIVITY.DRIVING:
      a.continuousDriveMin += durationMin;
      a.todayDriveMin      += durationMin;
      a.weekDriveMin       += durationMin;
      a.fortDriveMin       += durationMin;
      a.shiftMin           += durationMin;
      break;

    case ACTIVITY.BREAK:
      // Break resets continuous drive counter
      if (durationMin >= (session.regulation === REGULATION.EU_561
          ? EU_561.BREAK_DURATION_MIN : UK_DOMESTIC.BREAK_DURATION_MIN)) {
        a.continuousDriveMin = 0;
      }
      a.breakMin  += durationMin;
      a.shiftMin  += durationMin;
      break;

    case ACTIVITY.REST:
      a.todayRestMin      += durationMin;
      a.continuousDriveMin = 0;  // rest resets continuous drive
      break;

    case ACTIVITY.OTHER_WORK:
    case ACTIVITY.AVAILABLE:
      a.shiftMin += durationMin;
      break;
  }
}

// ─── INTERNAL: COMPLIANCE CHECKS ─────────────────────────────────────────────

function _runComplianceChecks(store, session, now, distanceKm = 0) {
  const violations = [];
  const a          = session.accum;
  const isEU       = session.regulation === REGULATION.EU_561;

  // ── Continuous drive ──────────────────────────────────────────────────────
  if (a.continuousDriveMin > (isEU ? EU_561.CONTINUOUS_DRIVE_MAX_MIN : UK_DOMESTIC.BREAK_AFTER_MIN)) {
    violations.push(_makeViolation(
      VIOLATION.CONTINUOUS_DRIVE_EXCEEDED,
      VIOLATION_SEVERITY.SERIOUS,
      `Continuous driving ${_fmt(a.continuousDriveMin)} exceeds ${isEU ? "EU 561" : "UK domestic"} limit of ${_fmt(isEU ? EU_561.CONTINUOUS_DRIVE_MAX_MIN : UK_DOMESTIC.BREAK_AFTER_MIN)}`,
      isEU ? "EU Reg 561/2006, Art. 7" : "UK Domestic Drivers' Hours Rules",
      session
    ));
  }

  // ── Daily drive — standard ────────────────────────────────────────────────
  const dailyStd = isEU ? EU_561.DAILY_DRIVE_STANDARD_MIN : UK_DOMESTIC.DAILY_DRIVE_MAX_MIN;
  const dailyExt = isEU ? EU_561.DAILY_DRIVE_EXTENDED_MIN : UK_DOMESTIC.DAILY_DRIVE_MAX_MIN;

  if (a.todayDriveMin > dailyExt) {
    violations.push(_makeViolation(
      VIOLATION.DAILY_DRIVE_EXTENDED_EXCEEDED,
      VIOLATION_SEVERITY.CRITICAL,
      `Daily driving ${_fmt(a.todayDriveMin)} exceeds absolute maximum ${_fmt(dailyExt)}`,
      isEU ? "EU Reg 561/2006, Art. 6(1)" : "UK Domestic Rules",
      session
    ));
  } else if (a.todayDriveMin > dailyStd) {
    if (isEU && a.extendedDaysUsed >= EU_561.EXTENDED_DAYS_PER_WEEK) {
      violations.push(_makeViolation(
        VIOLATION.DAILY_DRIVE_EXCEEDED,
        VIOLATION_SEVERITY.SERIOUS,
        `Daily driving ${_fmt(a.todayDriveMin)} exceeds 9h — extended days already used this week (${a.extendedDaysUsed}/${EU_561.EXTENDED_DAYS_PER_WEEK})`,
        "EU Reg 561/2006, Art. 6(1)",
        session
      ));
    }
    // else extended day is permitted — advisory only
  }

  // ── Weekly drive ──────────────────────────────────────────────────────────
  if (a.weekDriveMin > EU_561.WEEKLY_DRIVE_MIN && isEU) {
    violations.push(_makeViolation(
      VIOLATION.WEEKLY_DRIVE_EXCEEDED,
      VIOLATION_SEVERITY.SERIOUS,
      `Weekly driving ${_fmt(a.weekDriveMin)} exceeds 56h limit`,
      "EU Reg 561/2006, Art. 6(2)",
      session
    ));
  }

  // ── Fortnightly drive ─────────────────────────────────────────────────────
  if (a.fortDriveMin > EU_561.FORTNIGHTLY_DRIVE_MIN && isEU) {
    violations.push(_makeViolation(
      VIOLATION.FORTNIGHTLY_DRIVE_EXCEEDED,
      VIOLATION_SEVERITY.SERIOUS,
      `Fortnightly driving ${_fmt(a.fortDriveMin)} exceeds 90h limit`,
      "EU Reg 561/2006, Art. 6(3)",
      session
    ));
  }

  // ── Welfare: fatigue ──────────────────────────────────────────────────────
  if (a.continuousDriveMin >= WELFARE.FATIGUE_ALERT_MIN && !session.welfare.fatigueAlert) {
    session.welfare.fatigueAlert = true;
    violations.push(_makeViolation(
      VIOLATION.FATIGUE_ALERT,
      VIOLATION_SEVERITY.SERIOUS,
      `Driver fatigue alert — ${_fmt(a.continuousDriveMin)} continuous driving. Immediate break required.`,
      null, session
    ));
  } else if (a.continuousDriveMin >= WELFARE.FATIGUE_WARNING_MIN && !session.welfare.fatigueWarning) {
    session.welfare.fatigueWarning = true;
    violations.push(_makeViolation(
      VIOLATION.FATIGUE_WARNING,
      VIOLATION_SEVERITY.ADVISORY,
      `Driver fatigue advisory — ${_fmt(a.continuousDriveMin)} continuous driving. Plan break.`,
      null, session
    ));
  }

  // ── Welfare: shift length ─────────────────────────────────────────────────
  if (a.shiftMin >= WELFARE.SHIFT_CRITICAL_MIN) {
    violations.push(_makeViolation(
      VIOLATION.SHIFT_CRITICAL,
      VIOLATION_SEVERITY.CRITICAL,
      `Shift duration ${_fmt(a.shiftMin)} exceeds 12h — critical welfare threshold`,
      null, session
    ));
  } else if (a.shiftMin >= WELFARE.SHIFT_WARNING_MIN) {
    violations.push(_makeViolation(
      VIOLATION.SHIFT_LONG,
      VIOLATION_SEVERITY.ADVISORY,
      `Shift duration ${_fmt(a.shiftMin)} — approaching 12h welfare limit`,
      null, session
    ));
  }

  // ── Welfare: fuel ─────────────────────────────────────────────────────────
  if (distanceKm > 0) {
    if (distanceKm >= WELFARE.FUEL_CRITICAL_KM && !session.welfare.fuelCritical) {
      session.welfare.fuelCritical = true;
      violations.push(_makeViolation(
        VIOLATION.FUEL_CRITICAL,
        VIOLATION_SEVERITY.ADVISORY,
        `Distance ${distanceKm}km — fuel stop must be planned`,
        null, session
      ));
    } else if (distanceKm >= WELFARE.FUEL_ADVISORY_KM && !session.welfare.fuelAdvisory) {
      session.welfare.fuelAdvisory = true;
      violations.push(_makeViolation(
        VIOLATION.FUEL_ADVISORY,
        VIOLATION_SEVERITY.ADVISORY,
        `Distance ${distanceKm}km — fuel stop recommended`,
        null, session
      ));
    }
  }

  // Append new violations to session log (deduplicate by code+session)
  const existing = new Set(session.violations.map(v => v.code));
  const fresh    = violations.filter(v =>
    // Only dedup advisory/minor — serious/critical always log
    v.severity === VIOLATION_SEVERITY.ADVISORY || v.severity === VIOLATION_SEVERITY.MINOR
      ? !existing.has(v.code)
      : true
  );
  session.violations.push(...fresh);

  return fresh;
}

// ─── INTERNAL: HELPERS ────────────────────────────────────────────────────────

function _makeViolation(code, severity, message, legalRef, session) {
  return {
    code,
    severity,
    message,
    legalRef:  legalRef || null,
    sessionId: session.id,
    driverId:  session.driverId,
    timestamp: Date.now()
  };
}

function _resolveRegulation(vehicle) {
  if (!vehicle) return REGULATION.EU_561;
  return VEHICLE_REGULATION_MAP[vehicle.weightClass] || REGULATION.EU_561;
}

function _getActiveSession(store, driverId) {
  return Object.values(store.tacho || {})
    .find(s => s.driverId === driverId && s.status === SESSION_STATUS.ACTIVE) || null;
}

function _requireActiveSession(store, fleetId, driverId) {
  const session = _getActiveSession(store, driverId);
  if (!session) throw new Error(`No active tachograph session for driver ${driverId}`);
  if (session.fleetId !== fleetId) throw new Error(`Session does not belong to fleet ${fleetId}`);
  return session;
}

function _assertDriver(store, fleetId, driverId) {
  const driver = store.drivers?.[driverId];
  if (!driver) throw new Error(`Driver not found: ${driverId}`);
  if (driver.fleetId !== fleetId) throw new Error(`Driver does not belong to fleet ${fleetId}`);
  if (!driver.identityId) throw new Error(`Driver ${driverId} has no identity binding — RULE 2 violation`);
}

function _fmt(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : `${m}min`;
}
