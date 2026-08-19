/**
 * AT21 — quiz Punya values from punya_features / city-scoped punya_configs.
 * Per-event participation_points / win_points and push completion_points are
 * overrides only (NULL → feature default; 0 → disabled).
 */
import { db, punya_configs, punya_features } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createPointsCache } from "./punya-points-cache";

export const QUIZ_PARTICIPATION_FEATURE_KEY = "quiz_participation";
export const QUIZ_WIN_FEATURE_KEY = "quiz_win";
export const PUSH_QUIZ_COMPLETION_FEATURE_KEY = "push_quiz_completion";

/** Last-resort defaults when the catalogue row is missing (matches migration seed). */
const DEFAULT_PARTICIPATION = 5;
const DEFAULT_WIN = 25;
const DEFAULT_PUSH_COMPLETION = 5;

const TTL_MS = 60_000;

const cache = createPointsCache<number>("quiz", TTL_MS);

async function cacheGet(key: string): Promise<number | null> {
  const v = await cache.get(key);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function cacheSet(key: string, points: number): Promise<void> {
  await cache.set(key, points);
}

/** Clear caches (tests). */
export function clearQuizPointsCache(): void {
  cache.clear();
}

async function resolveFeatureDefault(
  featureKey: string,
  cityId: string | null,
  hardcoded: number,
): Promise<number> {
  const cacheKey = `punya:${featureKey}:${cityId ?? "global"}`;
  const cached = await cacheGet(cacheKey);
  if (cached != null && Number.isFinite(cached)) return cached;

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
      .orderBy(desc(punya_configs.updated_at), desc(punya_configs.id))
      .limit(1);
    if (cityCfg) {
      await cacheSet(cacheKey, cityCfg.points);
      return cityCfg.points;
    }
  }

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
    .orderBy(desc(punya_configs.updated_at), desc(punya_configs.id))
    .limit(1);
  if (globalCfg) {
    await cacheSet(cacheKey, globalCfg.points);
    return globalCfg.points;
  }

  const [feat] = await db
    .select({
      default_points: punya_features.default_points,
      max_points: punya_features.max_points,
      min_points: punya_features.min_points,
    })
    .from(punya_features)
    .where(and(eq(punya_features.key, featureKey), eq(punya_features.is_active, true)))
    .orderBy(desc(punya_features.updated_at), desc(punya_features.id))
    .limit(1);
  // M3 — default_points first. Falling back to max_points meant a feature's
  // CEILING was used as its normal value, so a catalogue entry could never
  // say "normally 10, never more than 25" — the two were forced equal.
  const fromFeature =
    feat?.default_points ?? feat?.max_points ?? feat?.min_points ?? null;
  const points = fromFeature != null && fromFeature > 0 ? fromFeature : hardcoded;
  await cacheSet(cacheKey, points);
  return points;
}

/**
 * Resolve participation points for a city.
 * `override` from quiz_events.participation_points: null → feature default; 0 → disabled.
 */
export async function resolveQuizParticipationPoints(
  cityId: string | null,
  override: number | null | undefined,
): Promise<number> {
  if (override != null) return Math.max(0, override);
  return resolveFeatureDefault(QUIZ_PARTICIPATION_FEATURE_KEY, cityId, DEFAULT_PARTICIPATION);
}

/**
 * Resolve win points for a city.
 * `override` from quiz_events.win_points: null → feature default; 0 → disabled.
 */
export async function resolveQuizWinPoints(
  cityId: string | null,
  override: number | null | undefined,
): Promise<number> {
  if (override != null) return Math.max(0, override);
  return resolveFeatureDefault(QUIZ_WIN_FEATURE_KEY, cityId, DEFAULT_WIN);
}

/**
 * Resolve push-quiz completion points for a city.
 * `override` from push_quizzes.completion_points: null → feature default; 0 → disabled.
 */
export async function resolvePushQuizCompletionPoints(
  cityId: string | null,
  override: number | null | undefined,
): Promise<number> {
  if (override != null) return Math.max(0, override);
  return resolveFeatureDefault(PUSH_QUIZ_COMPLETION_FEATURE_KEY, cityId, DEFAULT_PUSH_COMPLETION);
}
