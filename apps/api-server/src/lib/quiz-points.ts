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

/** The catalogue bounds a per-quiz override must respect. */
export type QuizPointsBounds = { min_points: number; max_points: number };

/**
 * H1 — `punya_features` bounds for a quiz feature.
 *
 * Migration 0031 seeds quiz_win with max_points = 25, but nothing enforced it:
 * the override path was `if (override != null) return Math.max(0, override)`
 * with Zod allowing 0..10000, so a city_admin could award 10,000 Punya per quiz
 * win. `punya.ts` has no clamp either. AT21 says point values resolve from
 * punya_features at award time — a ceiling nobody applies is not a ceiling.
 */
export async function quizPointsBounds(featureKey: string): Promise<QuizPointsBounds> {
  const [feat] = await db
    .select({
      min_points: punya_features.min_points,
      max_points: punya_features.max_points,
    })
    .from(punya_features)
    .where(and(eq(punya_features.key, featureKey), eq(punya_features.is_active, true)))
    .orderBy(desc(punya_features.updated_at), desc(punya_features.id))
    .limit(1);
  return { min_points: feat?.min_points ?? 0, max_points: feat?.max_points ?? 0 };
}

/**
 * Clamp an override into the catalogue bounds.
 *
 * Belt and braces: authoring is validated up front (validateQuizPointsOverride)
 * so an admin is told WHY their number was refused, but rows authored before
 * that guard — or edited straight in the database — must not out-pay the
 * catalogue at award time either.
 *
 * `0` stays `0`: disabled is a deliberate choice, not an under-run of min.
 * A max_points of 0 means "no ceiling recorded", matching course-points.ts.
 */
function clampToBounds(points: number, bounds: QuizPointsBounds): number {
  if (points <= 0) return 0;
  let out = points;
  if (bounds.min_points > 0 && out < bounds.min_points) out = bounds.min_points;
  if (bounds.max_points > 0 && out > bounds.max_points) out = bounds.max_points;
  return Math.max(0, out);
}

async function resolveWithOverride(
  featureKey: string,
  cityId: string | null,
  override: number | null | undefined,
  hardcoded: number,
): Promise<number> {
  if (override != null) return clampToBounds(override, await quizPointsBounds(featureKey));
  return resolveFeatureDefault(featureKey, cityId, hardcoded);
}

/**
 * Reject an out-of-bounds override at authoring time, so the admin sees the
 * allowed range instead of silently getting a different number than they typed.
 * Mirrors niyam-points.ts. Returns null when the value is acceptable.
 */
export async function validateQuizPointsOverride(
  featureKey: string,
  label: string,
  points: number | null | undefined,
): Promise<{ message: string } | null> {
  if (points == null) return null; // null = use the default; always fine.
  if (points === 0) return null; // 0 = deliberately disabled.
  const bounds = await quizPointsBounds(featureKey);
  if (bounds.min_points > 0 && points < bounds.min_points) {
    return { message: `${label} must be at least ${bounds.min_points}, or 0 to disable.` };
  }
  if (bounds.max_points > 0 && points > bounds.max_points) {
    return { message: `${label} must be at most ${bounds.max_points}.` };
  }
  return null;
}

/**
 * Resolve participation points for a city.
 * `override` from quiz_events.participation_points: null → feature default; 0 → disabled.
 */
export async function resolveQuizParticipationPoints(
  cityId: string | null,
  override: number | null | undefined,
): Promise<number> {
  return resolveWithOverride(
    QUIZ_PARTICIPATION_FEATURE_KEY,
    cityId,
    override,
    DEFAULT_PARTICIPATION,
  );
}

/**
 * Resolve win points for a city.
 * `override` from quiz_events.win_points: null → feature default; 0 → disabled.
 */
export async function resolveQuizWinPoints(
  cityId: string | null,
  override: number | null | undefined,
): Promise<number> {
  return resolveWithOverride(QUIZ_WIN_FEATURE_KEY, cityId, override, DEFAULT_WIN);
}

/**
 * Resolve push-quiz completion points for a city.
 * `override` from push_quizzes.completion_points: null → feature default; 0 → disabled.
 */
export async function resolvePushQuizCompletionPoints(
  cityId: string | null,
  override: number | null | undefined,
): Promise<number> {
  return resolveWithOverride(
    PUSH_QUIZ_COMPLETION_FEATURE_KEY,
    cityId,
    override,
    DEFAULT_PUSH_COMPLETION,
  );
}
