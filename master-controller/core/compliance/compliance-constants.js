// AP3X Compliance System — RUN 8
// Legal driving hours, break enforcement, rest rules.
// Statutory references: EU Regulation 561/2006 + AETR Agreement + UK retained law.
// Single source of truth for all compliance logic.
// DO NOT modify thresholds without updating compliance-validator.js accordingly.

// ─── REGULATION SETS ─────────────────────────────────────────────────────────
export const REGULATION = {
  EU_561:  "eu_561_2006",     // EU standard — applies to most HGV/PSV
  AETR:    "aetr",            // International road transport (same thresholds as EU 561)
  UK_DOMESTIC: "uk_domestic"  // UK domestic drivers' hours — lighter rules for smaller vehicles
};

// ─── VEHICLE SCOPE ────────────────────────────────────────────────────────────
// Which regulation applies by weight class
export const VEHICLE_REGULATION_MAP = {
  light:       REGULATION.UK_DOMESTIC,  // ≤3.5t — domestic rules
  medium:      REGULATION.EU_561,       // 3.5t–18t — EU rules
  heavy:       REGULATION.EU_561,       // 18t–44t — EU rules
  articulated: REGULATION.EU_561        // 44t — EU rules
};

// ─── EU 561/2006 THRESHOLDS ───────────────────────────────────────────────────
export const EU_561 = {
  // Daily driving limits
  DAILY_DRIVE_STANDARD_MIN:  540,   // 9h standard daily limit
  DAILY_DRIVE_EXTENDED_MIN:  600,   // 10h extended (max twice per week)
  EXTENDED_DAYS_PER_WEEK:    2,     // how many extended days allowed

  // Weekly / fortnightly
  WEEKLY_DRIVE_MIN:          3360,  // 56h
  FORTNIGHTLY_DRIVE_MIN:     5400,  // 90h across any two consecutive weeks

  // Continuous driving
  CONTINUOUS_DRIVE_MAX_MIN:  270,   // 4.5h max without break
  BREAK_DURATION_MIN:        45,    // minimum break after 4.5h
  BREAK_SPLIT_PART1_MIN:     15,    // first part of split break
  BREAK_SPLIT_PART2_MIN:     30,    // second part (must follow first)

  // Daily rest
  DAILY_REST_STANDARD_MIN:   660,   // 11h standard daily rest
  DAILY_REST_REDUCED_MIN:    540,   // 9h reduced (max 3x per week)
  REDUCED_REST_DAYS_PER_WEEK:3,     // max reduced rest days
  SPLIT_REST_PART1_MIN:      180,   // 3h — first part of split rest
  SPLIT_REST_PART2_MIN:      540,   // 9h — second part (must follow first)

  // Weekly rest
  WEEKLY_REST_REGULAR_MIN:   2700,  // 45h regular weekly rest
  WEEKLY_REST_REDUCED_MIN:   1440,  // 24h reduced weekly rest (must compensate)
  WEEKLY_REST_COMPENSATION_WEEKS: 3,// weeks to compensate reduced rest

  // Working week reference
  WEEK_REFERENCE_HOURS: 168         // 7 × 24h
};

// ─── UK DOMESTIC THRESHOLDS ───────────────────────────────────────────────────
export const UK_DOMESTIC = {
  DAILY_DRIVE_MAX_MIN:      600,    // 10h daily driving
  DAILY_DUTY_MAX_MIN:       840,    // 14h on-duty
  SPREAD_OVER_MAX_MIN:      960,    // 16h spread-over (start to finish)
  BREAK_AFTER_MIN:          330,    // 5.5h driving before break required
  BREAK_DURATION_MIN:       30,     // minimum break
  DAILY_REST_MIN:           600,    // 10h off-duty between shifts
  WEEKLY_REST_MIN:          1440    // 24h off per week
};

// ─── RISK / WELFARE THRESHOLDS ────────────────────────────────────────────────
export const WELFARE = {
  FATIGUE_WARNING_MIN:    240,    // 4h — advisory fatigue warning
  FATIGUE_ALERT_MIN:      300,    // 5h — alert level
  SHIFT_WARNING_MIN:      600,    // 10h shift — welfare flag
  SHIFT_CRITICAL_MIN:     720,    // 12h shift — critical flag
  FUEL_ADVISORY_KM:       450,    // suggest fuel stop after 450km
  FUEL_CRITICAL_KM:       600,    // fuel stop must be planned after 600km
  SLEEP_DEBT_THRESHOLD_H: 2       // hours short of required rest = fatigue debt
};

// ─── VIOLATION SEVERITY ───────────────────────────────────────────────────────
export const VIOLATION_SEVERITY = {
  ADVISORY:  "advisory",    // informational — no legal breach yet
  MINOR:     "minor",       // approaching limit
  SERIOUS:   "serious",     // limit breached — reportable
  CRITICAL:  "critical"     // absolute breach — immediate action required
};

// ─── VIOLATION CODES ─────────────────────────────────────────────────────────
export const VIOLATION = {
  // Driving time
  DAILY_DRIVE_EXCEEDED:         "V_DD_EXCEEDED",
  DAILY_DRIVE_EXTENDED_EXCEEDED:"V_DD_EXT_EXCEEDED",
  WEEKLY_DRIVE_EXCEEDED:        "V_WD_EXCEEDED",
  FORTNIGHTLY_DRIVE_EXCEEDED:   "V_FN_EXCEEDED",
  CONTINUOUS_DRIVE_EXCEEDED:    "V_CD_EXCEEDED",

  // Breaks
  BREAK_MISSED:                 "V_BREAK_MISSED",
  BREAK_TOO_SHORT:              "V_BREAK_SHORT",
  BREAK_SPLIT_INVALID:          "V_BREAK_SPLIT",

  // Rest
  DAILY_REST_INSUFFICIENT:      "V_DR_INSUFFICIENT",
  WEEKLY_REST_INSUFFICIENT:     "V_WR_INSUFFICIENT",
  REDUCED_REST_OVERUSED:        "V_DR_REDUCED_OVERUSED",

  // Welfare
  FATIGUE_WARNING:              "V_FATIGUE_WARNING",
  FATIGUE_ALERT:                "V_FATIGUE_ALERT",
  SHIFT_LONG:                   "V_SHIFT_LONG",
  SHIFT_CRITICAL:               "V_SHIFT_CRITICAL",

  // Fuel / welfare
  FUEL_ADVISORY:                "V_FUEL_ADVISORY",
  FUEL_CRITICAL:                "V_FUEL_CRITICAL"
};

// ─── SESSION STATUS ───────────────────────────────────────────────────────────
export const SESSION_STATUS = {
  ACTIVE:    "active",
  ON_BREAK:  "on_break",
  RESTING:   "resting",
  COMPLETE:  "complete"
};

// ─── ACTIVITY TYPES ───────────────────────────────────────────────────────────
export const ACTIVITY = {
  DRIVING:   "driving",
  BREAK:     "break",
  REST:      "rest",
  OTHER_WORK:"other_work",   // loading, admin, waiting etc.
  AVAILABLE: "available"     // on-call / available but not working
};
