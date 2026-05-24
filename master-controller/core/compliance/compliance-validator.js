// AP3X Compliance Validator — RUN 8
// Pre-route and standing compliance checks.
// Validates a driver's current state BEFORE a route is assigned or dispatched.
// Integrates with safety-engine.js — called as part of the pre-dispatch gate.
// Never throws. Always returns { compliant, violations, warnings, summary }.
// READ-ONLY from route/driver perspective — no mutations.

import {
  EU_561, UK_DOMESTIC, WELFARE,
  ACTIVITY, SESSION_STATUS, VIOLATION, VIOLATION_SEVERITY,
  VEHICLE_REGULATION_MAP, REGULATION
} from "./compliance-constants.js";
import { getActiveSession } from "./tachograph-engine.js";

// ─── PRE-ROUTE COMPLIANCE CHECK ───────────────────────────────────────────────

/**
 * Validate whether a driver is legally fit to start a given route RIGHT NOW.
 * Call this before dispatching any route.
 *
 * @param {object} store
 * @param {string} driverId
 * @param {object} route     - Route object from SSOT (for duration/distance)
 * @param {object} vehicle   - Vehicle object from SSOT
 * @returns {ComplianceResult}
 *   { compliant, violations, warnings, recommendation, summary }
 */
export function validatePreRoute(store, driverId, route, vehicle) {
  const violations = [];
  const warnings   = [];

  const session    = getActiveSession(store, driverId);
  const regulation = _resolveRegulation(vehicle);
  const limits     = regulation === REGULATION.EU_561 ? EU_561 : UK_DOMESTIC;

  const routeDurationMin  = route?.summary?.durationMin  || 0;
  const routeDistanceKm   = route?.summary?.distanceKm   || 0;

  // ── A. Current session state ──────────────────────────────────────────────
  const a = session ? session.accum : _zeroAccum();

  // ── B. Continuous drive projection ───────────────────────────────────────
  const projContinuous = a.continuousDriveMin + routeDurationMin;
  if (projContinuous > limits.CONTINUOUS_DRIVE_MAX_MIN || limits.BREAK_AFTER_MIN) {
    const cap = regulation === REGULATION.EU_561
      ? EU_561.CONTINUOUS_DRIVE_MAX_MIN
      : UK_DOMESTIC.BREAK_AFTER_MIN;

    if (projContinuous > cap) {
      violations.push(_v(
        VIOLATION.CONTINUOUS_DRIVE_EXCEEDED,
        VIOLATION_SEVERITY.SERIOUS,
        `Route would result in ${_fmt(projContinuous)} continuous driving — exceeds ${_fmt(cap)} limit`,
        regulation === REGULATION.EU_561 ? "EU Reg 561/2006, Art. 7" : "UK Domestic Rules"
      ));
    }
  }

  // ── C. Daily drive projection ─────────────────────────────────────────────
  const projDaily = a.todayDriveMin + routeDurationMin;
  const dailyStd  = regulation === REGULATION.EU_561
    ? EU_561.DAILY_DRIVE_STANDARD_MIN : UK_DOMESTIC.DAILY_DRIVE_MAX_MIN;
  const dailyExt  = regulation === REGULATION.EU_561
    ? EU_561.DAILY_DRIVE_EXTENDED_MIN : UK_DOMESTIC.DAILY_DRIVE_MAX_MIN;

  if (projDaily > dailyExt) {
    violations.push(_v(
      VIOLATION.DAILY_DRIVE_EXTENDED_EXCEEDED,
      VIOLATION_SEVERITY.CRITICAL,
      `Route would result in ${_fmt(projDaily)} total daily driving — exceeds absolute maximum ${_fmt(dailyExt)}`,
      "EU Reg 561/2006, Art. 6(1)"
    ));
  } else if (projDaily > dailyStd) {
    if (regulation === REGULATION.EU_561 && a.extendedDaysUsed >= EU_561.EXTENDED_DAYS_PER_WEEK) {
      violations.push(_v(
        VIOLATION.DAILY_DRIVE_EXCEEDED,
        VIOLATION_SEVERITY.SERIOUS,
        `Route would exceed 9h daily — extended allowance already used (${a.extendedDaysUsed}/${EU_561.EXTENDED_DAYS_PER_WEEK} days this week)`,
        "EU Reg 561/2006, Art. 6(1)"
      ));
    } else {
      warnings.push(_v(
        VIOLATION.DAILY_DRIVE_EXCEEDED,
        VIOLATION_SEVERITY.ADVISORY,
        `Route would use extended daily allowance — ${_fmt(projDaily)} of ${_fmt(dailyExt)} maximum`,
        "EU Reg 561/2006, Art. 6(1)"
      ));
    }
  }

  // ── D. Weekly drive projection ────────────────────────────────────────────
  if (regulation === REGULATION.EU_561) {
    const projWeekly = a.weekDriveMin + routeDurationMin;
    if (projWeekly > EU_561.WEEKLY_DRIVE_MIN) {
      violations.push(_v(
        VIOLATION.WEEKLY_DRIVE_EXCEEDED,
        VIOLATION_SEVERITY.SERIOUS,
        `Route would result in ${_fmt(projWeekly)} weekly driving — exceeds 56h limit`,
        "EU Reg 561/2006, Art. 6(2)"
      ));
    } else if (projWeekly > EU_561.WEEKLY_DRIVE_MIN * 0.9) {
      warnings.push(_v(
        VIOLATION.WEEKLY_DRIVE_EXCEEDED,
        VIOLATION_SEVERITY.ADVISORY,
        `Weekly driving ${_fmt(a.weekDriveMin)} — approaching 56h limit (${_fmt(projWeekly)} projected)`,
        "EU Reg 561/2006, Art. 6(2)"
      ));
    }
  }

  // ── E. Break requirement check ────────────────────────────────────────────
  const continuousNow = a.continuousDriveMin;
  const breakCap      = regulation === REGULATION.EU_561
    ? EU_561.CONTINUOUS_DRIVE_MAX_MIN : UK_DOMESTIC.BREAK_AFTER_MIN;

  if (continuousNow >= breakCap) {
    violations.push(_v(
      VIOLATION.BREAK_MISSED,
      VIOLATION_SEVERITY.SERIOUS,
      `Driver has already driven ${_fmt(continuousNow)} continuously — break required before any further driving`,
      regulation === REGULATION.EU_561 ? "EU Reg 561/2006, Art. 7" : "UK Domestic Rules"
    ));
  } else if (continuousNow > breakCap * 0.8) {
    warnings.push(_v(
      VIOLATION.BREAK_MISSED,
      VIOLATION_SEVERITY.ADVISORY,
      `Driver has driven ${_fmt(continuousNow)} continuously — ${_fmt(breakCap - continuousNow)} remaining before break required`,
      null
    ));
  }

  // ── F. Rest adequacy check ────────────────────────────────────────────────
  if (session) {
    const restMin = a.todayRestMin;
    const restReq = regulation === REGULATION.EU_561
      ? EU_561.DAILY_REST_REDUCED_MIN   // minimum acceptable (reduced)
      : UK_DOMESTIC.DAILY_REST_MIN;

    if (restMin < restReq && session.activities.some(act => act.type === ACTIVITY.REST)) {
      warnings.push(_v(
        VIOLATION.DAILY_REST_INSUFFICIENT,
        VIOLATION_SEVERITY.ADVISORY,
        `Rest so far today (${_fmt(restMin)}) is below minimum ${_fmt(restReq)} — check rest period completeness`,
        null
      ));
    }
  }

  // ── G. Welfare: fatigue ───────────────────────────────────────────────────
  if (session?.welfare.fatigueAlert) {
    violations.push(_v(
      VIOLATION.FATIGUE_ALERT,
      VIOLATION_SEVERITY.SERIOUS,
      "Driver fatigue alert is active — route assignment blocked until break recorded",
      null
    ));
  } else if (session?.welfare.fatigueWarning) {
    warnings.push(_v(
      VIOLATION.FATIGUE_WARNING,
      VIOLATION_SEVERITY.ADVISORY,
      "Driver fatigue warning active — plan break into route",
      null
    ));
  }

  // ── H. Shift duration projection ──────────────────────────────────────────
  const projShift = (session?.accum.shiftMin || 0) + routeDurationMin;
  if (projShift > WELFARE.SHIFT_CRITICAL_MIN) {
    violations.push(_v(
      VIOLATION.SHIFT_CRITICAL,
      VIOLATION_SEVERITY.CRITICAL,
      `Route would result in ${_fmt(projShift)} total shift — exceeds 12h critical welfare threshold`,
      null
    ));
  } else if (projShift > WELFARE.SHIFT_WARNING_MIN) {
    warnings.push(_v(
      VIOLATION.SHIFT_LONG,
      VIOLATION_SEVERITY.ADVISORY,
      `Route would result in ${_fmt(projShift)} total shift — approaching 12h welfare limit`,
      null
    ));
  }

  // ── I. Fuel range check ───────────────────────────────────────────────────
  if (routeDistanceKm >= WELFARE.FUEL_CRITICAL_KM) {
    warnings.push(_v(
      VIOLATION.FUEL_CRITICAL,
      VIOLATION_SEVERITY.ADVISORY,
      `Route distance ${routeDistanceKm}km — fuel stop must be planned`,
      null
    ));
  } else if (routeDistanceKm >= WELFARE.FUEL_ADVISORY_KM) {
    warnings.push(_v(
      VIOLATION.FUEL_ADVISORY,
      VIOLATION_SEVERITY.ADVISORY,
      `Route distance ${routeDistanceKm}km — fuel stop recommended`,
      null
    ));
  }

  // ── Build result ──────────────────────────────────────────────────────────
  const compliant     = violations.length === 0;
  const recommendation = _buildRecommendation(violations, warnings, a, limits, regulation);

  return {
    compliant,
    regulation,
    violations,
    warnings,
    currentAccum:    { ...a },
    projectedAccum: {
      continuousDriveMin: a.continuousDriveMin + routeDurationMin,
      todayDriveMin:      a.todayDriveMin      + routeDurationMin,
      weekDriveMin:       a.weekDriveMin       + routeDurationMin,
      shiftMin:           (a.shiftMin || 0)    + routeDurationMin
    },
    recommendation,
    summary: _buildSummary(compliant, violations, warnings)
  };
}

// ─── STANDING COMPLIANCE CHECK ────────────────────────────────────────────────

/**
 * Check a driver's compliance state at rest (no specific route context).
 * Used for fleet-wide compliance sweeps.
 */
export function checkStandingCompliance(store, driverId) {
  return validatePreRoute(store, driverId, null, null);
}

/**
 * Fleet-wide compliance sweep. Returns compliance state for all drivers.
 */
export function sweepFleetCompliance(store, fleetId) {
  const drivers = Object.values(store.drivers || {})
    .filter(d => d.fleetId === fleetId && d.status === "active");

  return drivers.map(d => {
    try {
      const result = checkStandingCompliance(store, d.id);
      return { driverId: d.id, name: d.name, ...result };
    } catch (err) {
      return { driverId: d.id, name: d.name, compliant: null, error: err.message };
    }
  });
}

// ─── BREAK SCHEDULING ─────────────────────────────────────────────────────────

/**
 * Calculate when a driver MUST next take a break, and for how long.
 * Returns { requiredAt, breakDurationMin, minutesRemaining }.
 * Used by route planner (future integration) to inject breaks into schedule.
 */
export function getNextBreakRequirement(store, driverId, vehicle) {
  const session    = getActiveSession(store, driverId);
  const regulation = _resolveRegulation(vehicle);
  const cap        = regulation === REGULATION.EU_561
    ? EU_561.CONTINUOUS_DRIVE_MAX_MIN
    : UK_DOMESTIC.BREAK_AFTER_MIN;
  const breakDur   = regulation === REGULATION.EU_561
    ? EU_561.BREAK_DURATION_MIN
    : UK_DOMESTIC.BREAK_DURATION_MIN;

  const driven          = session?.accum.continuousDriveMin || 0;
  const minutesRemaining = Math.max(0, cap - driven);
  const requiredAt      = minutesRemaining === 0 ? Date.now() : Date.now() + minutesRemaining * 60000;

  return {
    regulation,
    drivenMin:          driven,
    capMin:             cap,
    minutesRemaining:   parseFloat(minutesRemaining.toFixed(1)),
    breakDue:           minutesRemaining === 0,
    breakDurationMin:   breakDur,
    requiredAt,
    requiredAtISO:      new Date(requiredAt).toISOString()
  };
}

// ─── INTERNAL ────────────────────────────────────────────────────────────────

function _v(code, severity, message, legalRef) {
  return { code, severity, message, legalRef: legalRef || null, timestamp: Date.now() };
}

function _resolveRegulation(vehicle) {
  if (!vehicle) return REGULATION.EU_561;
  return VEHICLE_REGULATION_MAP[vehicle.weightClass] || REGULATION.EU_561;
}

function _zeroAccum() {
  return {
    continuousDriveMin: 0, todayDriveMin: 0, weekDriveMin: 0,
    fortDriveMin: 0, todayRestMin: 0, shiftMin: 0,
    breakMin: 0, extendedDaysUsed: 0, reducedRestDaysUsed: 0
  };
}

function _buildRecommendation(violations, warnings, accum, limits, regulation) {
  if (violations.length === 0 && warnings.length === 0) return "Driver is compliant — route may proceed.";

  const critical = violations.filter(v => v.severity === VIOLATION_SEVERITY.CRITICAL);
  if (critical.length > 0) {
    return `BLOCKED: ${critical[0].message}`;
  }

  const serious = violations.filter(v => v.severity === VIOLATION_SEVERITY.SERIOUS);
  if (serious.length > 0) {
    const contDriven = accum.continuousDriveMin;
    if (contDriven > 0) {
      return `Break required: driver has driven ${_fmt(contDriven)} — take ${_fmt(limits.BREAK_DURATION_MIN || EU_561.BREAK_DURATION_MIN)} break before departure.`;
    }
    return `Compliance issue: ${serious[0].message}`;
  }

  return `Proceed with caution — ${warnings.length} advisory warning(s). Monitor driver throughout route.`;
}

function _buildSummary(compliant, violations, warnings) {
  const icon = compliant ? "✓" : "✗";
  const lines = [`${icon} ${compliant ? "COMPLIANT" : "NON-COMPLIANT"}`];
  if (violations.length) lines.push(`${violations.length} violation(s):`);
  violations.slice(0, 3).forEach(v => lines.push(`  • [${v.severity.toUpperCase()}] ${v.message}`));
  if (warnings.length)  lines.push(`${warnings.length} warning(s) — see details.`);
  return lines.join("\n");
}

function _fmt(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : `${m}min`;
}
