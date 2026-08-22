/**
 * Streak badge ladder evaluation (decision D1 / finding 9).
 *
 * A rejection that breaks a streak does NOT revoke an earned badge — badges are
 * historical achievements. This module only inserts newly reached milestones.
 */
import { db, niyam_badges, punya_configs } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { niyamBadgeLabel, niyamBadgeLadder } from "@workspace/api-zod";
import { awardPunya } from "./punya";
import { notifyUsers } from "./notify";
import { logger } from "./logger";
import type { NiyamPeriodType } from "./niyam-period";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Fallback only. AT21: point values resolve from configuration at award time —
 * never inline a constant. This is the value used when no `niyam_badge` row
 * exists in punya_configs, matching the shipped default.
 */
export const NIYAM_BADGE_BONUS_POINTS = 25;

const BADGE_FEATURE_KEY = "niyam_badge";

/**
 * Resolve the badge bonus the same way attendance and niyam awards resolve
 * theirs: city punya_configs override, then global, then the default above.
 */
export async function resolveBadgeBonusPoints(
  cityId: string | null,
  exec: Tx | typeof db = db,
): Promise<number> {
  if (cityId) {
    const [cityCfg] = await exec
      .select({ points: punya_configs.points })
      .from(punya_configs)
      .where(
        and(
          eq(punya_configs.feature_key, BADGE_FEATURE_KEY),
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
        eq(punya_configs.feature_key, BADGE_FEATURE_KEY),
        isNull(punya_configs.city_id),
        eq(punya_configs.is_active, true),
      ),
    )
    .orderBy(desc(punya_configs.updated_at), desc(punya_configs.id))
    .limit(1);
  if (globalCfg) return globalCfg.points;
  return NIYAM_BADGE_BONUS_POINTS;
}

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
    /** Student's city, for the punya_configs override (AT21). */
    cityId?: string | null;
  },
  tx: Tx,
): Promise<AwardedBadge[]> {
  const ladder = niyamBadgeLadder(opts.niyamType);
  const reached = ladder.filter((m) => opts.currentStreak >= m.length);
  if (reached.length === 0) return [];

  const bonusPoints = await resolveBadgeBonusPoints(opts.cityId ?? null, tx);

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
        points_awarded: bonusPoints,
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
        points: bonusPoints,
        note: `Streak badge ${m.key}`,
        awardedBy: opts.awardedBy ?? null,
        idempotencyKey: `badge:${opts.studentId}:${opts.niyamId}:${m.key}`,
      },
      tx,
    );

    newly.push({
      badge_key: m.key,
      streak_length: m.length,
      points_awarded: bonusPoints,
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
  /** X-16 (review 2026-08) — the child's own Q4 login, if they have one. */
  studentUserId?: string | null;
  studentName: string;
  badges: AwardedBadge[];
}): Promise<void> {
  const userIds = [...new Set([opts.parentUserId, opts.studentUserId].filter((id): id is string => !!id))];
  if (userIds.length === 0 || opts.badges.length === 0) return;

  const labelsEn = opts.badges.map((b) => niyamBadgeLabel(b.badge_key, "en")).join(", ");
  const labelsHi = opts.badges.map((b) => niyamBadgeLabel(b.badge_key, "hi")).join(", ");

  // Request-handler path — never fail approve/badge award on notify.
  await notifyUsers({
    userIds,
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
    logger.warn({ err, userIds }, "notifyBadgesPush failed");
  });
}
