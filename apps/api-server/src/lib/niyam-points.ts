/**
 * Niyam points bounds (punya_features) and city overrides (punya_configs).
 */
import { db, punya_features, punya_configs } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";

const FEATURE_BOUNDS_KEY = "niyam_completion";
const AWARD_FEATURE_KEY = "niyam_submission";

export type PointsBoundsError = { message: string };

/** Validate niyam.points against punya_features.niyam_completion min/max when configured. */
export async function validateNiyamPointsBounds(
  points: number,
): Promise<PointsBoundsError | null> {
  const [feat] = await db
    .select({
      min_points: punya_features.min_points,
      max_points: punya_features.max_points,
      is_active: punya_features.is_active,
    })
    .from(punya_features)
    .where(eq(punya_features.key, FEATURE_BOUNDS_KEY))
    .limit(1);
  if (!feat || !feat.is_active) return null;
  if (feat.min_points != null && points < feat.min_points) {
    return { message: `Points must be at least ${feat.min_points}.` };
  }
  if (feat.max_points != null && points > feat.max_points) {
    return { message: `Points must be at most ${feat.max_points}.` };
  }
  return null;
}

/**
 * Validate a punya_configs value against the bounds of ITS OWN feature.
 *
 * `validateNiyamPointsBounds` keys on `niyam_completion` while awards resolve
 * under `niyam_submission`, so a config override bypassed min/max entirely: an
 * admin could not author a 5000-point niyam but could create a config that paid
 * 5000 for every niyam.
 */
export async function validatePunyaConfigPointsBounds(
  featureKey: string,
  points: number,
): Promise<PointsBoundsError | null> {
  const [feat] = await db
    .select({
      min_points: punya_features.min_points,
      max_points: punya_features.max_points,
      is_active: punya_features.is_active,
    })
    .from(punya_features)
    .where(eq(punya_features.key, featureKey))
    .limit(1);
  if (!feat || !feat.is_active) return null;
  if (feat.min_points != null && points < feat.min_points) {
    return { message: `Points must be at least ${feat.min_points}.` };
  }
  if (feat.max_points != null && points > feat.max_points) {
    return { message: `Points must be at most ${feat.max_points}.` };
  }
  return null;
}

/**
 * The punya_configs override for niyam awards, or null when none is set.
 *
 * Exposed separately so a LIST endpoint can resolve it once and apply it to
 * every row — calling resolveNiyamAwardPoints per niyam would issue two queries
 * per row for a value that cannot vary within one request.
 */
export async function resolveNiyamAwardOverride(
  cityId: string | null,
  exec: typeof db = db,
): Promise<number | null> {
  if (cityId) {
    const [cityCfg] = await exec
      .select({ points: punya_configs.points })
      .from(punya_configs)
      .where(
        and(
          eq(punya_configs.feature_key, AWARD_FEATURE_KEY),
          eq(punya_configs.city_id, cityId),
          eq(punya_configs.is_active, true),
        ),
      )
      .orderBy(desc(punya_configs.updated_at), desc(punya_configs.id))
      .limit(1);
    if (cityCfg) return cityCfg.points;
  }
  const [globalCfg] = await exec
    .select({ points: punya_configs.points })
    .from(punya_configs)
    .where(
      and(
        eq(punya_configs.feature_key, AWARD_FEATURE_KEY),
        isNull(punya_configs.city_id),
        eq(punya_configs.is_active, true),
      ),
    )
    .orderBy(desc(punya_configs.updated_at), desc(punya_configs.id))
    .limit(1);
  return globalCfg ? globalCfg.points : null;
}

/**
 * Resolve award points: city punya_configs override for niyam_submission, else
 * global (city_id null) config, else the niyam's configured points.
 */
export async function resolveNiyamAwardPoints(
  niyamPoints: number,
  cityId: string | null,
  exec: typeof db = db,
): Promise<number> {
  // ORDER BY is not cosmetic: a UNIQUE (feature_key, city_id) index now
  // prevents duplicates, but rows predating it can still exist, and an
  // unordered .limit(1) let the planner decide what a child was paid.
  if (cityId) {
    const [cityCfg] = await exec
      .select({ points: punya_configs.points })
      .from(punya_configs)
      .where(
        and(
          eq(punya_configs.feature_key, AWARD_FEATURE_KEY),
          eq(punya_configs.city_id, cityId),
          eq(punya_configs.is_active, true),
        ),
      )
      .orderBy(desc(punya_configs.updated_at), desc(punya_configs.id))
      .limit(1);
    if (cityCfg) return cityCfg.points;
  }

  const [globalCfg] = await exec
    .select({ points: punya_configs.points })
    .from(punya_configs)
    .where(
      and(
        eq(punya_configs.feature_key, AWARD_FEATURE_KEY),
        isNull(punya_configs.city_id),
        eq(punya_configs.is_active, true),
      ),
    )
    .orderBy(desc(punya_configs.updated_at), desc(punya_configs.id))
    .limit(1);
  if (globalCfg) return globalCfg.points;

  return niyamPoints;
}
