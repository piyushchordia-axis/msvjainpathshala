/**
 * resolveCourseAwardPoints — CU22 authored points × city multiplier, clamped
 * to punya_features.min_points/max_points (H3).
 *
 * Why this file exists: the clamp used to read `if (cfg.max_points > 0 &&
 * points > cfg.max_points)`. A missing or inactive punya_features row made
 * `max_points` default to 0, which made that condition FALSE — the clamp was
 * SKIPPED, not applied, and the raw multiplied points went out unclamped.
 * These tests pin the exact numeric award for a known multiplier (including
 * both clamp directions) and assert a missing/inactive catalogue row awards
 * exactly 0, not the unclamped raw value.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool, punya_configs, punya_features } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  resolveCourseAwardPoints,
  clearCoursePointsCache,
  COURSE_SECTION_FEATURE_KEY,
} from "../src/lib/course-points";

afterAll(async () => {
  await pool.end();
});

const FEATURE = COURSE_SECTION_FEATURE_KEY;
const AUTHORED = 40;

type FeatureRow = typeof punya_features.$inferSelect;

/** The migration-seeded row (0051) for course_section_certified — restored after every test. */
let seededFeature: FeatureRow;

beforeAll(async () => {
  const [row] = await db.select().from(punya_features).where(eq(punya_features.key, FEATURE)).limit(1);
  if (!row) {
    throw new Error(
      `punya_features row for "${FEATURE}" is missing — expected migration 0051's seed to have run`,
    );
  }
  seededFeature = row;
});

afterAll(async () => {
  // Leave the catalogue exactly as this file found it for every other suite.
  await db
    .insert(punya_features)
    .values(seededFeature)
    .onConflictDoUpdate({
      target: punya_features.id,
      set: {
        key: seededFeature.key,
        label: seededFeature.label,
        min_points: seededFeature.min_points,
        max_points: seededFeature.max_points,
        default_points: seededFeature.default_points,
        is_manual: seededFeature.is_manual,
        requires_reason: seededFeature.requires_reason,
        scope: seededFeature.scope,
        is_active: seededFeature.is_active,
      },
    });
  clearCoursePointsCache();
});

/** Remove every config row for the feature so each case starts from a clean multiplier. */
async function clearConfigs(): Promise<void> {
  await db.delete(punya_configs).where(eq(punya_configs.feature_key, FEATURE));
  clearCoursePointsCache();
}

/** Reset the seeded punya_features row's bounds/active flag for one case. */
async function setFeatureBounds(opts: {
  min: number;
  max: number;
  active: boolean;
}): Promise<void> {
  await db
    .update(punya_features)
    .set({ min_points: opts.min, max_points: opts.max, is_active: opts.active })
    .where(eq(punya_features.id, seededFeature.id));
  clearCoursePointsCache();
}

describe("resolveCourseAwardPoints — CU22 multiplier and H3 clamp", () => {
  it("exact numeric award for a known authored points × city multiplier", async () => {
    await clearConfigs();
    await setFeatureBounds({ min: 0, max: 1000, active: true });
    await db.insert(punya_configs).values({
      feature_key: FEATURE,
      points: 150, // 150% multiplier
      city_id: null,
      is_active: true,
    });
    // 40 authored × 150% = 60 exactly — round() lands exact, no clamp involved.
    await expect(resolveCourseAwardPoints(FEATURE, AUTHORED, null)).resolves.toBe(60);
  });

  it("clamps DOWN to max_points when the multiplied value exceeds it", async () => {
    await clearConfigs();
    await setFeatureBounds({ min: 0, max: 25, active: true });
    await db.insert(punya_configs).values({
      feature_key: FEATURE,
      points: 200, // 200%
      city_id: null,
      is_active: true,
    });
    // 40 × 200% = 80, clamped down to the 25 ceiling.
    await expect(resolveCourseAwardPoints(FEATURE, AUTHORED, null)).resolves.toBe(25);
  });

  it("clamps UP to min_points when the multiplied value is below it", async () => {
    await clearConfigs();
    await setFeatureBounds({ min: 15, max: 1000, active: true });
    await db.insert(punya_configs).values({
      feature_key: FEATURE,
      points: 10, // 10%
      city_id: null,
      is_active: true,
    });
    // 40 × 10% = 4, clamped up to the 15 floor.
    await expect(resolveCourseAwardPoints(FEATURE, AUTHORED, null)).resolves.toBe(15);
  });

  it("H3 — an inactive punya_features row awards exactly 0, never the unclamped value", async () => {
    await clearConfigs();
    // A generous multiplier that would mint plenty if the disable check were
    // skipped — this is exactly the shape of the pre-fix bug: max_points
    // would read 0 from the row default, the `max_points > 0` clamp guard
    // would be false, and this multiplier would escape unclamped.
    await db.insert(punya_configs).values({
      feature_key: FEATURE,
      points: 500,
      city_id: null,
      is_active: true,
    });
    await setFeatureBounds({ min: 0, max: 1000, active: false });
    await expect(resolveCourseAwardPoints(FEATURE, AUTHORED, null)).resolves.toBe(0);
  });

  it("H3 — a missing punya_features row awards exactly 0, never the unclamped value", async () => {
    await clearConfigs();
    await db.insert(punya_configs).values({
      feature_key: FEATURE,
      points: 500,
      city_id: null,
      is_active: true,
    });
    await db.delete(punya_features).where(eq(punya_features.id, seededFeature.id));
    clearCoursePointsCache();
    try {
      await expect(resolveCourseAwardPoints(FEATURE, AUTHORED, null)).resolves.toBe(0);
    } finally {
      // Restore before any other test in this file (or another suite, once
      // this one releases the serial-file lock) reads the row again.
      await db.insert(punya_features).values(seededFeature);
      clearCoursePointsCache();
    }
  });
});
