/**
 * H6 — BRD §7.2's manual award categories, resolved from the catalogue.
 *
 * The manual award was one undifferentiated bucket: `{student_id, points,
 * note?}` with no feature_key, so festival, seva, helping others, competition
 * and MSV shivir all collapsed into a single `manual_award` row distinguished
 * only by free text — and `note` was `.optional()`, so web-originated rows
 * showed `—` in the audit while the mobile sheet demanded a reason.
 *
 * Categories, their bounds and whether they need a reason are all DATA now, so
 * adding one is an INSERT and tightening one is an UPDATE.
 */
import { db, punya_features } from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";

/** The default when a caller names no category — the pre-existing behaviour. */
export const MANUAL_AWARD_DEFAULT_KEY = "manual_award";

export interface ManualCategory {
  key: string;
  label: string;
  min_points: number | null;
  max_points: number | null;
  default_points: number | null;
  requires_reason: boolean;
}

export type ManualCategoryError =
  | { code: "unknown"; message: string }
  | { code: "below_min"; message: string }
  | { code: "above_max"; message: string }
  | { code: "reason_required"; message: string };

/** Every category a human may award under, for the clients' picker. */
export async function listManualCategories(): Promise<ManualCategory[]> {
  const rows = await db
    .select({
      key: punya_features.key,
      label: punya_features.label,
      min_points: punya_features.min_points,
      max_points: punya_features.max_points,
      default_points: punya_features.default_points,
      requires_reason: punya_features.requires_reason,
    })
    .from(punya_features)
    .where(and(eq(punya_features.is_manual, true), eq(punya_features.is_active, true)))
    .orderBy(asc(punya_features.label));
  return rows;
}

async function loadCategory(key: string): Promise<ManualCategory | null> {
  const [row] = await db
    .select({
      key: punya_features.key,
      label: punya_features.label,
      min_points: punya_features.min_points,
      max_points: punya_features.max_points,
      default_points: punya_features.default_points,
      requires_reason: punya_features.requires_reason,
    })
    .from(punya_features)
    .where(
      and(
        eq(punya_features.key, key),
        eq(punya_features.is_manual, true),
        eq(punya_features.is_active, true),
      ),
    )
    .orderBy(desc(punya_features.updated_at), desc(punya_features.id))
    .limit(1);
  return row ?? null;
}

/**
 * Validate an award against its category.
 *
 * Returns the resolved category so the caller can record which one was used;
 * the per-role ceiling (punya_award_limits) still applies ON TOP of this, and
 * is checked inside the award transaction where the daily cap lives.
 */
export async function validateManualAward(input: {
  featureKey: string | undefined;
  points: number;
  note: string | null;
}): Promise<{ category: ManualCategory } | { error: ManualCategoryError }> {
  const key = input.featureKey?.trim() || MANUAL_AWARD_DEFAULT_KEY;
  const category = await loadCategory(key);
  if (!category) {
    return {
      error: {
        code: "unknown",
        message: `"${key}" is not a category you can award under — pick one from the list.`,
      },
    };
  }

  if (category.min_points != null && input.points < category.min_points) {
    return {
      error: {
        code: "below_min",
        message: `${category.label} awards start at ${category.min_points} Punya.`,
      },
    };
  }
  if (category.max_points != null && input.points > category.max_points) {
    return {
      error: {
        code: "above_max",
        message: `${category.label} awards go up to ${category.max_points} Punya.`,
      },
    };
  }

  // BRD §7.2 — amount AND reason. The web form said "Note (optional)" and the
  // server agreed, so rows arrived with nothing explaining them.
  if (category.requires_reason && (input.note == null || input.note.trim().length < 3)) {
    return {
      error: {
        code: "reason_required",
        message: `Add a short reason for this ${category.label.toLowerCase()} award — families see it on the child's Punya screen.`,
      },
    };
  }

  return { category };
}
