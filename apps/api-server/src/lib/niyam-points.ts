/**
 * Niyam points bounds (punya_features) and city overrides (punya_configs).
 */
import { db, punya_features, punya_configs } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

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
 * Resolve award points: city punya_configs override for niyam_submission, else
 * global (city_id null) config, else the niyam's configured points.
 */
export async function resolveNiyamAwardPoints(
  niyamPoints: number,
  cityId: string | null,
  exec: typeof db = db,
): Promise<number> {
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
    .limit(1);
  if (globalCfg) return globalCfg.points;

  return niyamPoints;
}
