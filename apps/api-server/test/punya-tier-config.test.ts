/**
 * AT23 — "These live in CONFIGURATION alongside punya_features, not as code
 * constants — adjustable without a migration."
 *
 * They were TIER_THRESHOLDS in enums.ts, so every adjustment needed a deploy,
 * and the same five numbers were re-inlined into three separate SQL CASE
 * ladders (creditBalance, creditBalancesFromReturned, punya.reconcile) with
 * nothing asserting the three agreed with each other or with tierForPoints.
 *
 * H19 rides along: a config write has to invalidate every points cache, not the
 * two of five it used to.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, db, punya_transactions, punya_balances } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TIER_THRESHOLDS } from "@workspace/db/enums";
import { withLedgerMaintenance } from "./helpers";
import {
  clearTierThresholdCache,
  nextTierFor,
  resolveTierThresholds,
  tierForPointsWith,
} from "../src/lib/punya-tiers";
import { awardPunya } from "../src/lib/punya";

const plantedStudentIds: string[] = [];

async function removePlantedStudents(): Promise<void> {
  if (plantedStudentIds.length === 0) return;
  await withLedgerMaintenance(async (c) => {
    await c.query(`delete from student_course_progress where student_id = any($1::uuid[])`, [
      plantedStudentIds,
    ]);
    await c.query(`delete from course_certificates where student_id = any($1::uuid[])`, [
      plantedStudentIds,
    ]);
    // L15 / Q11 — punya_transactions.student_id is RESTRICT, not CASCADE.
    await c.query(`delete from punya_transactions where student_id = any($1::uuid[])`, [
      plantedStudentIds,
    ]);
    await c.query(`delete from students where id = any($1::uuid[])`, [plantedStudentIds]);
  });
}

afterAll(async () => {
  await restoreLadder();
  await removePlantedStudents();
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

beforeEach(() => {
  clearTierThresholdCache();
});

async function restoreLadder(): Promise<void> {
  for (const [tier, min] of Object.entries(TIER_THRESHOLDS)) {
    await pool.query(`update punya_tier_thresholds set min_points = $2 where tier = $1`, [
      tier,
      min,
    ]);
  }
  clearTierThresholdCache();
}

async function plantStudent(tag: string): Promise<string> {
  const pick = await pool.query<{ batch_id: string; centre_id: string }>(
    `select b.id as batch_id, b.centre_id from batches b
      where b.deleted_at is null and b.status = 'active' limit 1`,
  );
  const { batch_id, centre_id } = pick.rows[0]!;
  const { rows } = await pool.query<{ id: string }>(
    `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
     values ($1, $2, $3, $4, 'active', '2015-01-01', 'male', 'bal')
     returning id`,
    [centre_id, batch_id, `TierCfg ${tag}`, `TC${tag}`.slice(0, 24)],
  );
  plantedStudentIds.push(rows[0]!.id);
  return rows[0]!.id;
}

describe("AT23 — the tier ladder is configuration", () => {
  it("the seeded table matches the documented ladder", async () => {
    const t = await resolveTierThresholds();
    expect(t).toEqual(TIER_THRESHOLDS);
  });

  it("editing a threshold changes the tier an award writes — no deploy", async () => {
    const studentId = await plantStudent(`${Date.now().toString(36).slice(-6)}`);

    // 150 points is Shravak under the documented ladder (101).
    await awardPunya({
      studentId,
      featureKey: "manual_award",
      points: 150,
      idempotencyKey: `tiercfg-a-${studentId}`,
    });
    const [before] = await db
      .select({ tier: punya_balances.tier })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    expect(before?.tier).toBe("shravak");

    // Raise the Shravak bar above their total and award 1 more point. The tier
    // the SQL ladder writes must follow the CONFIGURED value, not the constant.
    await pool.query(`update punya_tier_thresholds set min_points = 500 where tier = 'shravak'`);
    clearTierThresholdCache();

    await awardPunya({
      studentId,
      featureKey: "manual_award",
      points: 1,
      idempotencyKey: `tiercfg-b-${studentId}`,
    });
    const [after] = await db
      .select({ tier: punya_balances.tier, total_points: punya_balances.total_points })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    expect(after?.total_points).toBe(151);
    expect(after?.tier).toBe("jigyasu");

    await restoreLadder();
  });

  it("the reconcile ladder agrees with the award ladder", async () => {
    // Two implementations of one rule. Under a NON-default ladder they must
    // still land on the same tier, which is the case a shared constant could
    // never have caught.
    await pool.query(`update punya_tier_thresholds set min_points = 60 where tier = 'shravak'`);
    clearTierThresholdCache();

    const studentId = await plantStudent(`${Date.now().toString(36).slice(-6)}r`);
    await awardPunya({
      studentId,
      featureKey: "manual_award",
      points: 75,
      idempotencyKey: `tiercfg-c-${studentId}`,
    });
    const [awarded] = await db
      .select({ tier: punya_balances.tier })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    expect(awarded?.tier).toBe("shravak");

    const { reconcilePunyaBalances } = await import("../src/services/punya-reconcile");
    await reconcilePunyaBalances();

    const [reconciled] = await db
      .select({ tier: punya_balances.tier })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    // The reconcile must NOT "correct" a tier the award path wrote.
    expect(reconciled?.tier).toBe("shravak");

    await restoreLadder();
  });

  it("tierForPointsWith and nextTierFor agree at every boundary", async () => {
    const t = await resolveTierThresholds();
    expect(tierForPointsWith(t.shravak - 1, t)).toBe("jigyasu");
    expect(tierForPointsWith(t.shravak, t)).toBe("shravak");
    expect(tierForPointsWith(t.tirthankar, t)).toBe("tirthankar");

    expect(nextTierFor(0, t)).toEqual({
      next_tier: "shravak",
      points_to_next: t.shravak,
    });
    expect(nextTierFor(t.sadhak, t)).toEqual({
      next_tier: "shraman",
      points_to_next: t.shraman - t.sadhak,
    });
    // Nothing above Tirthankar — a progress bar must not promise one.
    expect(nextTierFor(t.tirthankar + 5000, t)).toEqual({
      next_tier: null,
      points_to_next: null,
    });
  });
});

describe("a student's FIRST award writes the right tier", () => {
  /**
   * Long-standing bug, found while proving AT23 rather than by the review.
   *
   * creditBalance's INSERT branch — taken exactly once per student, on their
   * first ever award — compared the new total against each threshold with BOTH
   * sides as bare bound parameters. Postgres infers `text` for an untyped
   * parameter, so the ladder compared STRINGS: '75' >= '5001' is true because
   * '7' sorts after '5'.
   *
   * A child's first 75 points therefore made them a Tirthankar, on the one
   * screen the whole module exists to make feel meaningful. It persisted
   * because punya.reconcile omitted `tier` from its DO UPDATE (H3), so
   * nothing ever recomputed it.
   *
   * 150 is included because it lands on the correct tier BY LUCK under string
   * comparison, which is why casual testing would never reveal this.
   */
  it.each([
    [75, "jigyasu"],
    [150, "shravak"],
    [600, "sadhak"],
    [1600, "shraman"],
    [6000, "tirthankar"],
  ])("a first award of %i points writes tier %s", async (points, expected) => {
    const studentId = await plantStudent(`${Date.now().toString(36).slice(-5)}${points}`);
    await awardPunya({
      studentId,
      featureKey: "manual_award",
      points,
      idempotencyKey: `first-award-${studentId}`,
    });
    const [row] = await db
      .select({ tier: punya_balances.tier, total_points: punya_balances.total_points })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    expect(row?.total_points).toBe(points);
    expect(row?.tier).toBe(expected);
  });
});

describe("H19 — a config write invalidates every points cache", () => {
  it("all five caches and the tier ladder are cleared by one call", async () => {
    const { invalidatePunyaPointCaches } = await import("../src/lib/punya-config-invalidate");
    const { resolveAttendanceAwardPoints } = await import("../src/lib/attendance-points");

    // Warm, change the value behind the cache, invalidate, re-read.
    const first = await resolveAttendanceAwardPoints(null);
    expect(first).toBe(10);

    await pool.query(
      `update punya_configs set points = 17, updated_at = now()
        where feature_key = 'attendance' and city_id is null`,
    );
    await invalidatePunyaPointCaches();
    expect(await resolveAttendanceAwardPoints(null)).toBe(17);

    await pool.query(
      `update punya_configs set points = 10, updated_at = now()
        where feature_key = 'attendance' and city_id is null`,
    );
    await invalidatePunyaPointCaches();
    expect(await resolveAttendanceAwardPoints(null)).toBe(10);
  });
});
