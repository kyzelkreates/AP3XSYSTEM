// AP3X Risk Scorer — RUN 5
// Produces a numeric risk score (0–100) and a structured findings list
// from a route, vehicle, driver, and store context.
// Called exclusively by safety-engine.js — never directly from API layer.
// READ-ONLY. Does not mutate store or route.

import {
  RISK_LEVEL,
  RISK_WEIGHTS,
  LEGAL_LIMITS,
  RISK_BANDS
} from "./safety-constants.js";

// ─── MAIN SCORER ─────────────────────────────────────────────────────────────

/**
 * Score a route against all safety dimensions.
 *
 * @param {object} route    - Route object from SSOT
 * @param {object} vehicle  - Vehicle object from SSOT
 * @param {object|null} driver  - Driver object from SSOT (may be null if unassigned)
 * @param {object} store    - SSOT (read-only)
 * @returns {ScorerResult}
 *   {
 *     score:    number (0–100),
 *     level:    RISK_LEVEL,
 *     findings: Finding[],
 *     breakdown: { category: score }
 *   }
 */
export function scoreRoute(route, vehicle, driver, store) {
  const findings   = [];
  const breakdown  = {
    drivers_hours:      0,
    vehicle_compliance: 0,
    identity:           0,
    operational:        0,
    advisory:           0
  };

  // ── A. Identity & binding checks ─────────────────────────────────────────
  _checkIdentity(route, vehicle, driver, store, findings, breakdown);

  // ── B. Drivers' hours & legal compliance ─────────────────────────────────
  _checkDriversHours(route, driver, findings, breakdown);

  // ── C. Vehicle compliance ─────────────────────────────────────────────────
  _checkVehicleCompliance(vehicle, findings, breakdown);

  // ── D. Operational risk ───────────────────────────────────────────────────
  _checkOperationalRisk(route, findings, breakdown);

  // ── E. Advisory flags ────────────────────────────────────────────────────
  _checkAdvisory(route, vehicle, findings, breakdown);

  // ── Compute total score (capped at 100) ──────────────────────────────────
  const rawScore = Object.values(breakdown).reduce((s, v) => s + v, 0);
  const score    = Math.min(100, rawScore);
  const level    = _scoreToLevel(score);

  return { score, level, findings, breakdown };
}

// ─── CHECK FUNCTIONS ─────────────────────────────────────────────────────────

function _checkIdentity(route, vehicle, driver, store, findings, breakdown) {
  // Vehicle must have fleet assignment (RULE 3)
  if (!vehicle || vehicle.status !== "active") {
    _addFinding(findings, breakdown, {
      ruleId:    "AP3X_VEHICLE_RULE_3",
      category:  "identity",
      severity:  RISK_LEVEL.CRITICAL,
      score:     RISK_WEIGHTS.VEHICLE_NOT_ACTIVE,
      message:   `Vehicle is not active (status: ${vehicle?.status || "unknown"})`,
      legal:     false
    });
  }

  if (vehicle && !vehicle.fleetId) {
    _addFinding(findings, breakdown, {
      ruleId:    "AP3X_VEHICLE_RULE_3",
      category:  "identity",
      severity:  RISK_LEVEL.CRITICAL,
      score:     RISK_WEIGHTS.NO_FLEET_ASSIGNMENT,
      message:   "Vehicle has no fleet assignment — RULE 3 violation",
      legal:     false
    });
  }

  // Driver identity binding (RULE 2)
  if (route.driverId) {
    if (!driver) {
      _addFinding(findings, breakdown, {
        ruleId:    "AP3X_IDENTITY_RULE_2",
        category:  "identity",
        severity:  RISK_LEVEL.CRITICAL,
        score:     RISK_WEIGHTS.NO_IDENTITY_BINDING,
        message:   `Driver ID ${route.driverId} not found in store`,
        legal:     false
      });
    } else if (!driver.identityId) {
      _addFinding(findings, breakdown, {
        ruleId:    "AP3X_IDENTITY_RULE_2",
        category:  "identity",
        severity:  RISK_LEVEL.CRITICAL,
        score:     RISK_WEIGHTS.NO_IDENTITY_BINDING,
        message:   `Driver "${driver.name}" has no active identity binding — RULE 2 violation`,
        legal:     false
      });
    } else {
      // Confirm identity is still active in store
      const identity = store.identities[driver.identityId];
      if (!identity || identity.status !== "active") {
        _addFinding(findings, breakdown, {
          ruleId:    "AP3X_IDENTITY_RULE_2",
          category:  "identity",
          severity:  RISK_LEVEL.CRITICAL,
          score:     RISK_WEIGHTS.NO_IDENTITY_BINDING,
          message:   `Driver "${driver.name}" identity is not active (status: ${identity?.status || "missing"})`,
          legal:     false
        });
      }
    }
  } else {
    // No driver assigned — unusual but not a hard block
    _addFinding(findings, breakdown, {
      ruleId:    "OPERATIONAL_NO_DRIVER",
      category:  "operational",
      severity:  RISK_LEVEL.LOW,
      score:     RISK_WEIGHTS.NO_DRIVER_ASSIGNED,
      message:   "No driver assigned to route — unattended dispatch",
      legal:     false
    });
  }
}

function _checkDriversHours(route, driver, findings, breakdown) {
  const durationMin = route.summary?.durationMin || 0;

  // Continuous drive check (EU 561/2006)
  if (durationMin > LEGAL_LIMITS.MAX_CONTINUOUS_DRIVE_MIN) {
    const isExtended = durationMin > LEGAL_LIMITS.MAX_DAILY_DRIVE_EXTENDED;
    const isStandard = durationMin > LEGAL_LIMITS.MAX_DAILY_DRIVE_MIN;

    if (isExtended) {
      _addFinding(findings, breakdown, {
        ruleId:   "EU_561_EXTENDED_LIMIT",
        category: "drivers_hours",
        severity: RISK_LEVEL.CRITICAL,
        score:    RISK_WEIGHTS.DRIVING_HOURS_BREACH + 10,
        message:  `Route duration ${_fmt(durationMin)} exceeds EU 10h extended limit — absolute breach`,
        legal:    true,
        reference:"EU Regulation 561/2006, Article 6(1)"
      });
    } else if (isStandard) {
      _addFinding(findings, breakdown, {
        ruleId:   "EU_561_DAILY_LIMIT",
        category: "drivers_hours",
        severity: RISK_LEVEL.HIGH,
        score:    RISK_WEIGHTS.EXTENDED_HOURS_BREACH,
        message:  `Route duration ${_fmt(durationMin)} exceeds EU 9h standard limit (10h extended requires prior usage)`,
        legal:    true,
        reference:"EU Regulation 561/2006, Article 6(1)"
      });
    } else {
      // 4.5h–9h: break required
      _addFinding(findings, breakdown, {
        ruleId:   "EU_561_CONTINUOUS_DRIVE",
        category: "drivers_hours",
        severity: RISK_LEVEL.HIGH,
        score:    RISK_WEIGHTS.BREAK_REQUIRED,
        message:  `Route duration ${_fmt(durationMin)} exceeds 4.5h continuous limit — mandatory 45min break required`,
        legal:    true,
        reference:"EU Regulation 561/2006, Article 7"
      });
    }
  } else if (durationMin > 240) {
    // 4h+: advisory
    _addFinding(findings, breakdown, {
      ruleId:   "EU_561_BREAK_ADVISORY",
      category: "drivers_hours",
      severity: RISK_LEVEL.LOW,
      score:    5,
      message:  `Route duration ${_fmt(durationMin)} approaching 4.5h continuous limit — plan break`,
      legal:    true,
      reference:"EU Regulation 561/2006, Article 7"
    });
  }
}

function _checkVehicleCompliance(vehicle, findings, breakdown) {
  if (!vehicle) return;

  // Height
  if (vehicle.height != null) {
    if (vehicle.height > LEGAL_LIMITS.MAX_VEHICLE_HEIGHT_M) {
      _addFinding(findings, breakdown, {
        ruleId:   "UK_CONSTRUCTION_REGS_HEIGHT",
        category: "vehicle_compliance",
        severity: RISK_LEVEL.HIGH,
        score:    RISK_WEIGHTS.VEHICLE_HEIGHT_BREACH,
        message:  `Vehicle height ${vehicle.height}m exceeds maximum ${LEGAL_LIMITS.MAX_VEHICLE_HEIGHT_M}m`,
        legal:    true,
        reference:"UK C&U Regulations 1986, Reg 7"
      });
    } else if (vehicle.height > 4.0) {
      _addFinding(findings, breakdown, {
        ruleId:   "VEHICLE_HEIGHT_ADVISORY",
        category: "advisory",
        severity: RISK_LEVEL.LOW,
        score:    RISK_WEIGHTS.TALL_VEHICLE_ADVISORY,
        message:  `Vehicle height ${vehicle.height}m — height restrictions apply on some routes (bridges, car parks)`,
        legal:    false
      });
    }
  }

  // Width
  if (vehicle.width != null) {
    if (vehicle.width > LEGAL_LIMITS.MAX_VEHICLE_WIDTH_M) {
      _addFinding(findings, breakdown, {
        ruleId:   "UK_CONSTRUCTION_REGS_WIDTH",
        category: "vehicle_compliance",
        severity: RISK_LEVEL.MEDIUM,
        score:    RISK_WEIGHTS.VEHICLE_WIDTH_BREACH,
        message:  `Vehicle width ${vehicle.width}m exceeds standard ${LEGAL_LIMITS.MAX_VEHICLE_WIDTH_M}m — wide load rules apply`,
        legal:    true,
        reference:"UK Road Vehicles (Construction and Use) Regulations 1986"
      });
    } else if (vehicle.width > 2.4) {
      _addFinding(findings, breakdown, {
        ruleId:   "VEHICLE_WIDTH_ADVISORY",
        category: "advisory",
        severity: RISK_LEVEL.LOW,
        score:    RISK_WEIGHTS.WIDE_LOAD_ADVISORY,
        message:  `Vehicle width ${vehicle.width}m — check lane-width restrictions on route`,
        legal:    false
      });
    }
  }

  // Fuel type — LEZ/CAZ advisory
  if (vehicle.fuelType === "diesel" || vehicle.fuelType === "petrol") {
    _addFinding(findings, breakdown, {
      ruleId:   "LEZ_CAZ_ADVISORY",
      category: "advisory",
      severity: RISK_LEVEL.LOW,
      score:    4,
      message:  `Vehicle fuel type "${vehicle.fuelType}" — verify LEZ/CAZ compliance for route area`,
      legal:    false
    });
  }
}

function _checkOperationalRisk(route, findings, breakdown) {
  const { distanceKm = 0, durationMin = 0, dropCount = 0 } = route.summary || {};
  const drops = route.drops || [];
  const legs  = route.legs  || [];

  // Distance
  if (distanceKm > LEGAL_LIMITS.MAX_ROUTE_DISTANCE_KM) {
    _addFinding(findings, breakdown, {
      ruleId:   "ROUTE_DISTANCE_EXCESSIVE",
      category: "operational",
      severity: RISK_LEVEL.HIGH,
      score:    RISK_WEIGHTS.ROUTE_DISTANCE_EXCESSIVE,
      message:  `Route distance ${distanceKm}km exceeds maximum ${LEGAL_LIMITS.MAX_ROUTE_DISTANCE_KM}km`,
      legal:    false
    });
  } else if (distanceKm > LEGAL_LIMITS.MAX_ROUTE_DISTANCE_KM * 0.75) {
    _addFinding(findings, breakdown, {
      ruleId:   "ROUTE_DISTANCE_WARNING",
      category: "operational",
      severity: RISK_LEVEL.MEDIUM,
      score:    10,
      message:  `Route distance ${distanceKm}km is approaching limit (${LEGAL_LIMITS.MAX_ROUTE_DISTANCE_KM}km)`,
      legal:    false
    });
  }

  // Drop count
  const effectiveDropCount = drops.length || dropCount;
  if (effectiveDropCount > 45) {
    _addFinding(findings, breakdown, {
      ruleId:   "EXTREME_DROP_COUNT",
      category: "operational",
      severity: RISK_LEVEL.MEDIUM,
      score:    RISK_WEIGHTS.EXTREME_DROP_COUNT,
      message:  `Route has ${effectiveDropCount} drops — extremely high complexity`,
      legal:    false
    });
  } else if (effectiveDropCount > 30) {
    _addFinding(findings, breakdown, {
      ruleId:   "HIGH_DROP_COUNT",
      category: "operational",
      severity: RISK_LEVEL.LOW,
      score:    RISK_WEIGHTS.HIGH_DROP_COUNT,
      message:  `Route has ${effectiveDropCount} drops — high complexity, verify driver capacity`,
      legal:    false
    });
  }

  // Zero-duration legs (bad coordinate data)
  const zeroLegs = legs.filter(l => l.durationMin <= 0);
  if (zeroLegs.length > 0) {
    _addFinding(findings, breakdown, {
      ruleId:   "ZERO_DURATION_LEG",
      category: "operational",
      severity: RISK_LEVEL.MEDIUM,
      score:    RISK_WEIGHTS.ZERO_DURATION_LEG * zeroLegs.length,
      message:  `${zeroLegs.length} leg(s) have zero duration — check coordinate accuracy`,
      legal:    false
    });
  }

  // Routing provider stub mode
  if (route.provider === "osm_fallback" && route.legs?.[0]?.instructions?.[0]?.startsWith("[OSM SIM]")) {
    _addFinding(findings, breakdown, {
      ruleId:   "PROVIDER_STUB_MODE",
      category: "operational",
      severity: RISK_LEVEL.LOW,
      score:    RISK_WEIGHTS.PROVIDER_STUB_MODE,
      message:  "Route computed via simulation (haversine) — no road topology applied. Distances are estimates only.",
      legal:    false
    });
  }
}

function _checkAdvisory(route, vehicle, findings, breakdown) {
  // Electric vehicle range
  if (vehicle?.fuelType === "electric") {
    const distanceKm = route.summary?.distanceKm || 0;
    if (distanceKm > 250) {
      _addFinding(findings, breakdown, {
        ruleId:   "ELECTRIC_RANGE_CONCERN",
        category: "advisory",
        severity: RISK_LEVEL.MEDIUM,
        score:    RISK_WEIGHTS.ELECTRIC_RANGE_CONCERN,
        message:  `Electric vehicle route distance (${distanceKm}km) may require en-route charging — no charge point logic yet (RUN 4+)`,
        legal:    false
      });
    }
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _addFinding(findings, breakdown, finding) {
  findings.push({
    ruleId:    finding.ruleId,
    category:  finding.category,
    severity:  finding.severity,
    score:     finding.score,
    message:   finding.message,
    legal:     finding.legal || false,
    reference: finding.reference || null
  });
  breakdown[finding.category] = (breakdown[finding.category] || 0) + finding.score;
}

function _scoreToLevel(score) {
  if (score >= 85) return RISK_LEVEL.CRITICAL;
  if (score >= 60) return RISK_LEVEL.HIGH;
  if (score >= 30) return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.LOW;
}

function _fmt(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : `${m}min`;
}
