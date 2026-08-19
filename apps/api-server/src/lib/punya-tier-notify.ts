/**
 * BRD §7.5 — tell the family when a child reaches a new Punya tier (H4, M5).
 *
 * Nothing detected a tier transition before this. creditBalance computed the new
 * tier in SQL and returned only total_points, so the old tier was unavailable by
 * construction; the bulk path had no RETURNING at all; punya_balances had no
 * tier_reached_at; and there was no punya/tier notification kind. Crossing into
 * Sadhak produced no animation, no push and no certificate — not because they
 * were unimplemented, but because the information had already been thrown away.
 *
 * Upgrades only. A reversal can move a child down a tier, and no child should be
 * told by push that they lost one — the same reasoning as Q5a, where a badge
 * survives a later review decision because punishing a child for an adult's
 * correction is the wrong trade.
 */
import { db, students } from "@workspace/db";
import { TIERS } from "@workspace/db/enums";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { notifyUsers } from "./notify";

/** Bilingual tier names. Jain terms stay untranslated (CLAUDE.md). */
const TIER_LABELS: Record<string, { en: string; hi: string }> = {
  jigyasu: { en: "Jigyasu", hi: "जिज्ञासु" },
  shravak: { en: "Shravak", hi: "श्रावक" },
  sadhak: { en: "Sadhak", hi: "साधक" },
  shraman: { en: "Shraman", hi: "श्रमण" },
  tirthankar: { en: "Tirthankar", hi: "तीर्थंकर" },
};

/** True when `next` sits above `prev` on the ladder. */
export function isTierUpgrade(prev: string | null | undefined, next: string): boolean {
  if (!prev) return false;
  const a = TIERS.indexOf(prev as (typeof TIERS)[number]);
  const b = TIERS.indexOf(next as (typeof TIERS)[number]);
  if (a < 0 || b < 0) return false;
  return b > a;
}

/**
 * Notify the parent that their child reached a new tier.
 *
 * Never throws: a push failure must not roll back an award that has already
 * committed, nor fail the request that produced it.
 */
export async function notifyTierUpgrade(opts: {
  studentId: string;
  previousTier: string | null | undefined;
  newTier: string;
  totalPoints: number;
}): Promise<void> {
  if (!isTierUpgrade(opts.previousTier, opts.newTier)) return;

  try {
    const [student] = await db
      .select({ full_name: students.full_name, parent_id: students.parent_id })
      .from(students)
      .where(eq(students.id, opts.studentId))
      .limit(1);
    if (!student?.parent_id) return;

    const label = TIER_LABELS[opts.newTier] ?? { en: opts.newTier, hi: opts.newTier };
    const name = student.full_name;

    await notifyUsers({
      userIds: [student.parent_id],
      kind: "punya_tier",
      title_en: `${name} is now ${label.en}`,
      title_hi: `${name} अब ${label.hi} हैं`,
      body_en: `${name} has reached ${opts.totalPoints} Punya and moved up to ${label.en}.`,
      body_hi: `${name} ने ${opts.totalPoints} पुण्य प्राप्त कर ${label.hi} स्तर पाया है।`,
      data: {
        kind: "punya_tier",
        student_id: opts.studentId,
        tier: opts.newTier,
        previous_tier: opts.previousTier ?? null,
        total_points: opts.totalPoints,
      },
    });
  } catch (err) {
    logger.error(
      { err, student_id: opts.studentId, tier: opts.newTier },
      "punya tier upgrade notification failed",
    );
  }
}
