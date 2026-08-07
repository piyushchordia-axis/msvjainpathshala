/**
 * CU22 — course Punya: authored points × city multiplier percent, clamped.
 * Never inline a constant (AT21). Snapshot the resolved value into the ledger.
 */
import { db, punya_configs, punya_features } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export const COURSE_SECTION_FEATURE_KEY = "course_section_certified";
export const COURSE_COMPLETED_FEATURE_KEY = "course_completed";

type FeatureBounds = { min_points: number; max_points: number; multiplier: number };

const memCache = new Map<string, { value: FeatureBounds; expiresAt: number }>();
const TTL_MS = 60_000;

async function resolveFeature(
  featureKey: string,
  cityId: string | null,
): Promise<FeatureBounds> {
  const cacheKey = `course-punya:${featureKey}:${cityId ?? "global"}`;
  const hit = memCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  let multiplier: number | null = null;
  if (cityId) {
    const [cityCfg] = await db
      .select({ points: punya_configs.points })
      .from(punya_configs)
      .where(
        and(
          eq(punya_configs.feature_key, featureKey),
          eq(punya_configs.city_id, cityId),
          eq(punya_configs.is_active, true),
        ),
      )
      .limit(1);
    if (cityCfg) multiplier = cityCfg.points;
  }
  if (multiplier == null) {
    const [globalCfg] = await db
      .select({ points: punya_configs.points })
      .from(punya_configs)
      .where(
        and(
          eq(punya_configs.feature_key, featureKey),
          isNull(punya_configs.city_id),
          eq(punya_configs.is_active, true),
        ),
      )
      .limit(1);
    if (globalCfg) multiplier = globalCfg.points;
  }

  const [feat] = await db
    .select({
      min_points: punya_features.min_points,
      max_points: punya_features.max_points,
    })
    .from(punya_features)
    .where(and(eq(punya_features.key, featureKey), eq(punya_features.is_active, true)))
    .limit(1);

  const value: FeatureBounds = {
    min_points: feat?.min_points ?? 0,
    max_points: feat?.max_points ?? 0,
    // Missing config → 0 multiplier → award 0 (CU22 seed landmine).
    multiplier: multiplier ?? 0,
  };
  memCache.set(cacheKey, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/**
 * award = ROUND(authored * multiplier / 100.0) clamped to min..max.
 * Points of 0 award nothing (caller skips the ledger write).
 */
export async function resolveCourseAwardPoints(
  featureKey: typeof COURSE_SECTION_FEATURE_KEY | typeof COURSE_COMPLETED_FEATURE_KEY,
  authoredPoints: number,
  cityId: string | null,
): Promise<number> {
  if (authoredPoints <= 0) return 0;
  const cfg = await resolveFeature(featureKey, cityId);
  if (cfg.multiplier <= 0) return 0;
  let points = Math.round((authoredPoints * cfg.multiplier) / 100.0);
  if (cfg.min_points > 0 && points < cfg.min_points) points = cfg.min_points;
  if (cfg.max_points > 0 && points > cfg.max_points) points = cfg.max_points;
  return Math.max(0, points);
}

export function clearCoursePointsCache(): void {
  memCache.clear();
}

/** CU23 idempotency keys. */
export function sectionAwardKey(sectionId: string, studentId: string, revision: number): string {
  return `course_section_certified:${sectionId}:${studentId}:${revision}`;
}

export function sectionReverseKey(sectionId: string, studentId: string, revision: number): string {
  return `course_section_certified:reverse:${sectionId}:${studentId}:${revision}`;
}

export function courseAwardKey(
  courseId: string,
  studentId: string,
  triggerSectionId: string,
  revision: number,
): string {
  return `course_completed:${courseId}:${studentId}:${triggerSectionId}:${revision}`;
}

export function courseReverseKey(
  courseId: string,
  studentId: string,
  triggerSectionId: string,
  revision: number,
): string {
  return `course_completed:reverse:${courseId}:${studentId}:${triggerSectionId}:${revision}`;
}
