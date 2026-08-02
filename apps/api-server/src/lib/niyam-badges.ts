/**
 * Streak badge ladder evaluation (decision D1 / finding 9).
 *
 * A rejection that breaks a streak does NOT revoke an earned badge — badges are
 * historical achievements. This module only inserts newly reached milestones.
 */
import { db, niyam_badges, notifications, device_push_tokens, users } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { niyamBadgeLabel, niyamBadgeLadder } from "@workspace/api-zod";
import { awardPunya } from "./punya";
import { sendPush } from "./push";
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
 * Inserts the bilingual inbox row first (gates at-most-once push), then
 * best-effort push in the parent's preferred_language.
 */
export async function notifyBadgesPush(opts: {
  parentUserId: string | null;
  studentName: string;
  badges: AwardedBadge[];
}): Promise<void> {
  if (!opts.parentUserId || opts.badges.length === 0) return;

  const labelsEn = opts.badges.map((b) => niyamBadgeLabel(b.badge_key, "en")).join(", ");
  const labelsHi = opts.badges.map((b) => niyamBadgeLabel(b.badge_key, "hi")).join(", ");
  const titleEn = "Streak badge earned!";
  const titleHi = "लकीर बैज मिला!";
  const bodyEn = `${opts.studentName} earned: ${labelsEn}`;
  const bodyHi = `${opts.studentName} ने अर्जित किया: ${labelsHi}`;

  const [inserted] = await db
    .insert(notifications)
    .values({
      user_id: opts.parentUserId,
      kind: "niyam_badge",
      title_en: titleEn,
      title_hi: titleHi,
      body_en: bodyEn,
      body_hi: bodyHi,
    })
    .returning({ id: notifications.id });

  if (!inserted) return;

  let tokens: { expo_token: string }[] = [];
  try {
    tokens = await db
      .select({ expo_token: device_push_tokens.expo_token })
      .from(device_push_tokens)
      .where(
        and(
          eq(device_push_tokens.user_id, opts.parentUserId),
          eq(device_push_tokens.is_active, true),
        ),
      );
  } catch (err) {
    logger.warn(
      { err, userId: opts.parentUserId, kind: "niyam_badge" },
      "Failed to load device_push_tokens for badge notification",
    );
    return;
  }
  if (tokens.length === 0) return;

  const [parent] = await db
    .select({ preferred_language: users.preferred_language })
    .from(users)
    .where(eq(users.id, opts.parentUserId))
    .limit(1);
  const hi = parent?.preferred_language === "hi";

  await sendPush(
    tokens.map((t) => ({
      to: t.expo_token,
      title: hi ? titleHi : titleEn,
      body: hi ? bodyHi : bodyEn,
      data: { kind: "niyam_badge", badges: opts.badges.map((b) => b.badge_key) },
    })),
  );
}
