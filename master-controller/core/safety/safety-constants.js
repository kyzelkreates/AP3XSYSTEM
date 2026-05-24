// AP3X Safety AI Gatekeeper — RUN 5
// Shared constants, thresholds, and legal compliance rules.
// This is the single source of truth for all safety logic.
// DO NOT modify without updating safety-engine.js and risk-scorer.js accordingly.

// ─── RISK LEVELS ──────────────────────────────────────────────────────────────
export const RISK_LEVEL = {
  LOW:      "low",
  MEDIUM:   "medium",
  HIGH:     "high",
  CRITICAL: "critical"   // instant rejection — no override possible
};

// ─── DECISION OUTCOMES ───────────────────────────────────────────────────────
export const DECISION = {
  APPROVED:          "approved",
  REJECTED:          "rejected",
  APPROVED_WITH_WARNINGS: "approved_with_warnings"
};

// ─── RISK SCORE BANDS ────────────────────────────────────────────────────────
// Score 0–100. Bands determine decision outcome.
export const RISK_BANDS = {
  LOW:      { min: 0,  max: 29, level: "low",      decision: DECISION.APPROVED },
  MEDIUM:   { min: 30, max: 59, level: "medium",   decision: DECISION.APPROVED_WITH_WARNINGS },
  HIGH:     { min: 60, max: 84, level: "high",      decision: DECISION.REJECTED },
  CRITICAL: { min: 85, max: 100,level: "critical",  decision: DECISION.REJECTED }
};

// ─── LEGAL COMPLIANCE RULES (UK/EU) ──────────────────────────────────────────
export const LEGAL_LIMITS = {
  // Driving hours (EU Regulation 561/2006)
  MAX_CONTINUOUS_DRIVE_MIN: 270,    // 4.5h before mandatory break
  MANDATORY_BREAK_MIN:      45,     // minimum break duration
  MAX_DAILY_DRIVE_MIN:      540,    // 9h standard (10h allowed twice/week)
  MAX_DAILY_DRIVE_EXTENDED: 600,    // 10h extended limit
  MAX_WEEKLY_DRIVE_MIN:     3360,   // 56h
  MAX_FORTNIGHTLY_DRIVE_MIN:5400,   // 90h

  // Vehicle dimensions (UK/EU)
  MAX_VEHICLE_HEIGHT_M:     4.95,
  MAX_VEHICLE_WIDTH_M:      2.55,
  MAX_VEHICLE_LENGTH_M:     18.75,  // articulated max

  // Weight limits (GVW in tonnes)
  MAX_WEIGHT_TONNES: {
    light:       3.5,
    medium:      18,
    heavy:       44,
    articulated: 44
  },

  // Route hard limits
  MAX_ROUTE_DISTANCE_KM:  1500,
  MAX_ROUTE_DURATION_MIN: 720,    // 12h absolute cap
  MAX_DROPS:              50,
  MIN_DROPS:              1,

  // Rest/break requirements
  BREAK_REQUIRED_AFTER_MIN: 270,   // trigger break requirement
  MIN_REST_BETWEEN_SHIFTS:  660    // 11h minimum daily rest
};

// ─── RISK SCORE WEIGHTS ───────────────────────────────────────────────────────
// Each check contributes a score. Weights are calibrated to 0–100 total range.
export const RISK_WEIGHTS = {
  // Legal compliance failures (high weight — these are hard rules)
  DRIVING_HOURS_BREACH:       40,
  EXTENDED_HOURS_BREACH:      30,
  NO_IDENTITY_BINDING:        35,   // RULE 2 — driver not bound
  VEHICLE_NOT_ACTIVE:         50,   // hard block
  VEHICLE_HEIGHT_BREACH:      45,
  VEHICLE_WIDTH_BREACH:       40,
  VEHICLE_WEIGHT_BREACH:      45,
  NO_FLEET_ASSIGNMENT:        50,   // RULE 3

  // Operational risk factors (medium weight)
  ROUTE_DISTANCE_EXCESSIVE:   25,
  ROUTE_DURATION_WARNING:     20,
  HIGH_DROP_COUNT:            10,   // >30 drops
  EXTREME_DROP_COUNT:         20,   // >45 drops
  ZERO_DURATION_LEG:          15,
  PROVIDER_STUB_MODE:         10,   // routing is simulated, not live
  NO_DRIVER_ASSIGNED:         8,    // no driver on route (unusual)

  // Advisory factors (low weight)
  ELECTRIC_RANGE_CONCERN:     12,
  WIDE_LOAD_ADVISORY:         8,
  TALL_VEHICLE_ADVISORY:      8,
  BREAK_REQUIRED:             18,   // 4.5h+ route without break plan
  EXTENDED_HOURS_ADVISORY:    15,
};

// ─── LEGAL RULE REGISTRY ─────────────────────────────────────────────────────
// Each rule: { id, description, weight, category, severity }
export const LEGAL_RULES = [
  {
    id:          "EU_561_CONTINUOUS_DRIVE",
    description: "EU Reg 561/2006: Continuous driving exceeds 4.5h — mandatory 45min break required",
    weight:      RISK_WEIGHTS.DRIVING_HOURS_BREACH,
    category:    "drivers_hours",
    severity:    RISK_LEVEL.HIGH
  },
  {
    id:          "EU_561_DAILY_LIMIT",
    description: "EU Reg 561/2006: Daily driving time exceeds 9h standard limit",
    weight:      RISK_WEIGHTS.EXTENDED_HOURS_BREACH,
    category:    "drivers_hours",
    severity:    RISK_LEVEL.HIGH
  },
  {
    id:          "EU_561_EXTENDED_LIMIT",
    description: "EU Reg 561/2006: Daily driving time exceeds 10h extended limit — absolute breach",
    weight:      RISK_WEIGHTS.DRIVING_HOURS_BREACH + 10,
    category:    "drivers_hours",
    severity:    RISK_LEVEL.CRITICAL
  },
  {
    id:          "UK_CONSTRUCTION_REGS_HEIGHT",
    description: "UK C&U Regulations: Vehicle height exceeds 4.95m — infrastructure risk",
    weight:      RISK_WEIGHTS.VEHICLE_HEIGHT_BREACH,
    category:    "vehicle_compliance",
    severity:    RISK_LEVEL.HIGH
  },
  {
    id:          "UK_CONSTRUCTION_REGS_WIDTH",
    description: "UK C&U Regulations: Vehicle width exceeds 2.55m — wide load rules apply",
    weight:      RISK_WEIGHTS.VEHICLE_WIDTH_BREACH,
    category:    "vehicle_compliance",
    severity:    RISK_LEVEL.MEDIUM
  },
  {
    id:          "AP3X_IDENTITY_RULE_2",
    description: "AP3X RULE 2: Driver has no active identity binding — fleet trust not established",
    weight:      RISK_WEIGHTS.NO_IDENTITY_BINDING,
    category:    "identity",
    severity:    RISK_LEVEL.CRITICAL
  },
  {
    id:          "AP3X_VEHICLE_RULE_3",
    description: "AP3X RULE 3: Vehicle has no fleet assignment — cannot be dispatched",
    weight:      RISK_WEIGHTS.NO_FLEET_ASSIGNMENT,
    category:    "identity",
    severity:    RISK_LEVEL.CRITICAL
  }
];
