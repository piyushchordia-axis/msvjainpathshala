/**
 * Streak badge ladder evaluation (decision D1 / finding 9).
 *
 * A rejection that breaks a streak does NOT revoke an earned badge — badges are
 * historical achievements. This module only inserts newly reached milestones.
 */
import { db, niyam_badges, device_push_tokens } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { awardPunya } from "./punya";
import { sendPush } from "./push";
import type { NiyamPeriodType } from "./niyam-period";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const NIYAM_BADGE_BONUS_POINTS = 25;

const MILESTONES: Record<NiyamPeriodType, Array<{ key: string; length: number }>> = {
  daily: [
    { key: "daily_7", length: 7 },
    { key: "daily_14", length: 14 },
    { key: "daily_30", length: 30 },
    { key: "daily_60", length: 60 },
    { key: "daily_100", length: 100 },
  ],
  weekly: [{ key: "weekly_4", length: 4 }],
  monthly: [{ key: "monthly_3", length: 3 }],
};

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
  const ladder = MILESTONES[opts.niyamType] ?? [];
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

/** Best-effort push after badge awards (post-commit). */
export async function notifyBadgesPush(opts: {
  parentUserId: string | null;
  studentName: string;
  badges: AwardedBadge[];
}): Promise<void> {
  if (!opts.parentUserId || opts.badges.length === 0) return;
  try {
    const tokens = await db
      .select({ expo_token: device_push_tokens.expo_token })
      .from(device_push_tokens)
      .where(
        and(
          eq(device_push_tokens.user_id, opts.parentUserId),
          eq(device_push_tokens.is_active, true),
        ),
      );
    if (tokens.length === 0) return;
    const label = opts.badges.map((b) => b.badge_key).join(", ");
    await sendPush(
      tokens.map((t) => ({
        to: t.expo_token,
        title: "Streak badge earned!",
        body: `${opts.studentName} earned: ${label}`,
        data: { kind: "niyam_badge", badges: opts.badges.map((b) => b.badge_key) },
      })),
    );
  } catch {
    // Best-effort.
  }
}
