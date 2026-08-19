/**
 * Canonical Punya feature catalogue (AT21).
 *
 * ONE list, imported by seed.ts and asserted against a migration-built database
 * by punya-catalogue-parity.test.ts.
 *
 * Why this file exists: the catalogue had two sources of truth that silently
 * diverged in both directions. seed.ts inserted `attendance`; no migration did
 * (C2 — every attendance mark awarded 0 and wrote no ledger row). Migration
 * 0012 inserted `attendance_streak`; the seed did not, and the seed TRUNCATEs
 * punya_features first, so a migrate-then-seed database lost the streak config
 * the admin UI still offered to edit.
 *
 * Neither gap was visible from either side alone. Adding a key here and to a
 * guarded migration keeps them in lockstep; the parity test fails the build if
 * they drift again.
 *
 * No DB import — this must stay loadable without DATABASE_URL.
 */

export interface PunyaFeatureSeed {
  key: string;
  label: string;
  min_points: number;
  max_points: number;
  is_active: boolean;
  /** SPEC 5.7 (M3) — the normal value, distinct from the ceiling. */
  default_points?: number;
  /** Granted by a human through the manual-award surface (BRD 7.2). */
  is_manual?: boolean;
  /** Amount AND reason mandatory (BRD 7.2). */
  requires_reason?: boolean;
}

export interface PunyaConfigSeed {
  feature_key: string;
  points: number;
  city_id: null;
  is_active: boolean;
}

/** Every feature key the runtime can award under. */
export const PUNYA_FEATURE_CATALOGUE: readonly PunyaFeatureSeed[] = [
  { key: "attendance", label: "Attendance", min_points: 0, max_points: 10, is_active: true },
  // AT22 — 20 pts every 4 attended, repeating. Bounds are exact (20/20)
  // because the value is a fixed bonus, not a range.
  { key: "attendance_streak", label: "Attendance streak bonus", min_points: 20, max_points: 20, is_active: true },
  { key: "niyam_completion", label: "Niyam completion", min_points: 0, max_points: 1000, is_active: true },
  // What the runtime actually awards under (niyam-submit.ts / niyam-approve.ts).
  // `niyam_completion` above is the bounds key the admin UI validates against.
  { key: "niyam_submission", label: "Niyam completed", min_points: 0, max_points: 1000, is_active: true },
  { key: "niyam_badge", label: "Niyam streak badge", min_points: 0, max_points: 500, is_active: true },
  { key: "homework", label: "Homework approved", min_points: 0, max_points: 10, is_active: true },
  { key: "homework_starred", label: "Homework starred", min_points: 0, max_points: 12, is_active: true },
  { key: "exam_completion", label: "Exam completion (pass)", min_points: 0, max_points: 500, is_active: true },
  { key: "exam_top_score", label: "Exam top score", min_points: 0, max_points: 500, is_active: true },
  { key: "quiz_participation", label: "Quiz participation", min_points: 0, max_points: 5, is_active: true },
  { key: "quiz_win", label: "Quiz win", min_points: 0, max_points: 25, is_active: true },
  { key: "push_quiz_completion", label: "Push quiz completion", min_points: 0, max_points: 5, is_active: true },
  { key: "manual_award", label: "Manual admin award", min_points: 0, max_points: 500, is_active: true, is_manual: true, requires_reason: true },
  // BRD 7.2's five manual categories. Deliberately distinct keys from the
  // automated ones: folding a hand-granted competition award into
  // `competition` would make it indistinguishable from a published result.
  { key: "manual_festival", label: "Festival participation", min_points: 0, max_points: 50, default_points: 15, is_active: true, is_manual: true, requires_reason: true },
  { key: "manual_seva", label: "Seva", min_points: 10, max_points: 50, default_points: 10, is_active: true, is_manual: true, requires_reason: true },
  { key: "manual_helping", label: "Helping others", min_points: 10, max_points: 30, default_points: 10, is_active: true, is_manual: true, requires_reason: true },
  { key: "manual_competition", label: "Competition (manual)", min_points: 0, max_points: 100, default_points: 25, is_active: true, is_manual: true, requires_reason: true },
  // Amounts come from competitions.winner_points / participant_points, so
  // there is deliberately no punya_configs default for this key.
  { key: "competition", label: "Competition result", min_points: 0, max_points: 100000, is_active: true },
  // AT28 — the documented path for shivir Punya.
  { key: "msv_shivir", label: "Shivir participation", min_points: 0, max_points: 500, is_active: true, is_manual: true, requires_reason: true },
  { key: "course_section_certified", label: "Course section certified", min_points: 0, max_points: 1000, is_active: true },
  { key: "course_completed", label: "Course completed", min_points: 0, max_points: 2000, is_active: true },
];

/** Global (city_id NULL) point values. Cities override these per AT21. */
export const PUNYA_CONFIG_DEFAULTS: readonly PunyaConfigSeed[] = [
  { feature_key: "attendance", points: 10, city_id: null, is_active: true },
  { feature_key: "attendance_streak", points: 20, city_id: null, is_active: true },
  { feature_key: "exam_completion", points: 20, city_id: null, is_active: true },
  { feature_key: "exam_top_score", points: 50, city_id: null, is_active: true },
  { feature_key: "quiz_participation", points: 5, city_id: null, is_active: true },
  { feature_key: "quiz_win", points: 25, city_id: null, is_active: true },
  { feature_key: "push_quiz_completion", points: 5, city_id: null, is_active: true },
  // CU22 — integer percent multipliers (100 = 1x), not absolute points.
  { feature_key: "course_section_certified", points: 100, city_id: null, is_active: true },
  { feature_key: "course_completed", points: 100, city_id: null, is_active: true },
];

/**
 * Keys the runtime awards under that MUST resolve to a non-zero value.
 *
 * Excludes the two multiplier keys (course_*, where 100 means 1x and the real
 * value comes from the course) and `manual_award` / `msv_shivir` / `niyam_*`,
 * whose amounts are caller-supplied or authored per row rather than resolved
 * from a config. What remains is every key where a cold catalogue means a
 * silent zero award — the C2 failure mode.
 */
export const PUNYA_KEYS_REQUIRING_NONZERO_DEFAULT: readonly string[] = [
  "attendance",
  "attendance_streak",
  "homework",
  "exam_completion",
  "exam_top_score",
  "quiz_participation",
  "quiz_win",
  "push_quiz_completion",
];
