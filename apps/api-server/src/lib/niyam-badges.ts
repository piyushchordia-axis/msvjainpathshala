/**
 * Streak badge ladder evaluation (decision D1 / finding 9).
 *
 * A rejection that breaks a streak does NOT revoke an earned badge — badges are
 * historical achievements. This module only inserts newly reached milestones.
 */
import { db, niyam_badges } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { niyamBadgeLabel, niyamBadgeLadder } from "@workspace/api-zod";
import { awardPunya } from "./punya";
import { notifyUsers } from "./notify";
import { logger } from "./logger";
import type { NiyamPeriodType } from "./niyam-period";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const NIYAM_BADGE_BONUS_POINTS = 25;

export type AwardedBadge = {
  badge_key: string;
  streak_length: number;
  points_awarded: number;
};

/**
 * Insert badges for every milestone ≤ currentStreak that the student does not
 * already hold. Unique index makes this idempotent under concurrent recomputes.
 */
export async function awardNewlyReachedBadges(
  opts: {
    studentId: string;
    niyamId: string;
    niyamType: NiyamPeriodType;
    currentStreak: number;
    awardedBy?: string | null;
  },
  tx: Tx,
): Promise<AwardedBadge[]> {
  const ladder = niyamBadgeLadder(opts.niyamType);
  const reached = ladder.filter((m) => opts.currentStreak >= m.length);
  if (reached.length === 0) return [];

  const existing = await tx
    .select({ badge_key: niyam_badges.badge_key })
    .from(niyam_badges)
    .where(
      and(
        eq(niyam_badges.student_id, opts.studentId),
        eq(niyam_badges.niyam_id, opts.niyamId),
      ),
    );
  const have = new Set(existing.map((e) => e.badge_key));
  const newly: AwardedBadge[] = [];

  for (const m of reached) {
    if (have.has(m.key)) continue;
    const inserted = await tx
      .insert(niyam_badges)
      .values({
        student_id: opts.studentId,
        niyam_id: opts.niyamId,
        badge_key: m.key,
        streak_length: m.length,
        points_awarded: NIYAM_BADGE_BONUS_POINTS,
      })
      .onConflictDoNothing({
        target: [niyam_badges.student_id, niyam_badges.niyam_id, niyam_badges.badge_key],
      })
      .returning({ id: niyam_badges.id });
    if (inserted.length === 0) continue;

    await awardPunya(
      {
        studentId: opts.studentId,
        featureKey: "niyam_badge",
        points: NIYAM_BADGE_BONUS_POINTS,
        note: `Streak badge ${m.key}`,
        awardedBy: opts.awardedBy ?? null,
        idempotencyKey: `badge:${opts.studentId}:${opts.niyamId}:${m.key}`,
      },
      tx,
    );

    newly.push({
      badge_key: m.key,
      streak_length: m.length,
      points_awarded: NIYAM_BADGE_BONUS_POINTS,
    });
  }

  return newly;
}

/**
 * Post-commit parent alert when streak badges are earned.
 * Routes through notifyUsers so notification_preferences are honoured and
 * push copy uses preferred_language (FIX #5 pulled forward with FIX #2).
 */
export async function notifyBadgesPush(opts: {
  parentUserId: string | null;
  studentName: string;
  badges: AwardedBadge[];
}): Promise<void> {
  if (!opts.parentUserId || opts.badges.length === 0) return;

  const labelsEn = opts.badges.map((b) => niyamBadgeLabel(b.badge_key, "en")).join(", ");
  const labelsHi = opts.badges.map((b) => niyamBadgeLabel(b.badge_key, "hi")).join(", ");

  // Request-handler path — never fail approve/badge award on notify.
  await notifyUsers({
    userIds: [opts.parentUserId],
    kind: "niyam_badge",
    title_en: "Streak badge earned!",
    title_hi: "लकीर बैज मिला!",
    body_en: `${opts.studentName} earned: ${labelsEn}`,
    body_hi: `${opts.studentName} ने अर्जित किया: ${labelsHi}`,
    push: true,
    data: {
      kind: "niyam_badge",
      badges: opts.badges.map((b) => b.badge_key),
    },
  }).catch((err) => {
    logger.warn({ err, parentUserId: opts.parentUserId }, "notifyBadgesPush failed");
  });
}
