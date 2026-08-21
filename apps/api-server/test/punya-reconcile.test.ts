/**
 * H3 — Step 16's exit criterion for punya.reconcile:
 * "corrupt a balance, run the reconcile, it restores correctness AND alerts ops".
 *
 * Neither half held. The job hardcoded 'jigyasu' on insert and omitted `tier`
 * from the DO UPDATE, so a restored Tirthankar kept a Jigyasu badge forever; it
 * grouped over punya_transactions, so a balance with no ledger rows was
 * unreachable; and it logged nothing, so it reported success identically
 * whether it had repaired ten thousand rows or none.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, db, punya_transactions, punya_balances } from "@workspace/db";
import { withLedgerMaintenance } from "./helpers";
import { eq } from "drizzle-orm";
import { TIER_THRESHOLDS } from "@workspace/db/enums";
import { reconcilePunyaBalances } from "../src/services/punya-reconcile";

/** Planted fixtures, torn down in afterAll so they cannot fill the batch. */
const plantedStudentIds: string[] = [];

/**
 * The ledger is append-only at the database (0090) and students cascade into
 * it, so teardown declares itself. Without this these fixtures accumulate
 * across runs and push the shared batch past capacity, failing unrelated
 * tests (enrolments' auto-approve begins returning 409).
 */
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
  await removePlantedStudents();
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

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
    [centre_id, batch_id, `Reconcile ${tag}`, `RC${tag}`.slice(0, 24)],
  );
  plantedStudentIds.push(rows[0]!.id);
  return rows[0]!.id;
}

async function readBalance(
  studentId: string,
): Promise<{ total_points: number; tier: string } | undefined> {
  const [row] = await db
    .select({ total_points: punya_balances.total_points, tier: punya_balances.tier })
    .from(punya_balances)
    .where(eq(punya_balances.student_id, studentId))
    .limit(1);
  return row;
}

describe("H3 — punya.reconcile restores correctness and reports drift", () => {
  it("repairs BOTH total_points and tier", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}`;
    const studentId = await plantStudent(tag);

    // A genuine Tirthankar in the ledger.
    const points = TIER_THRESHOLDS.tirthankar + 1199;
    await db.insert(punya_transactions).values({
      student_id: studentId,
      feature_key: "manual_award",
      points,
      note: "reconcile fixture",
      idempotency_key: `reconcile-${tag}`,
    });

    // Corrupt the balance the way a stray UPDATE would: wrong points, wrong tier.
    await db
      .update(punya_balances)
      .set({ total_points: 3, tier: "jigyasu" })
      .where(eq(punya_balances.student_id, studentId));

    const result = await reconcilePunyaBalances();

    const after = await readBalance(studentId);
    expect(after?.total_points).toBe(points);
    // The half the old job never did: tier was omitted from the DO UPDATE.
    expect(after?.tier).toBe("tirthankar");

    expect(result.drifted).toBeGreaterThan(0);
    expect(result.netPointsMoved).not.toBe(0);
    expect(result.samples.some((s) => s.student_id === studentId)).toBe(true);
  });

  it("reaches a balance that has no ledger rows behind it", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}o`;
    const studentId = await plantStudent(tag);

    // A balance conjured from nowhere — the corruption most worth catching, and
    // the one GROUP BY over punya_transactions could never produce a row for.
    await db.insert(punya_balances).values({
      student_id: studentId,
      total_points: 900,
      tier: "sadhak",
    });

    const result = await reconcilePunyaBalances();

    const after = await readBalance(studentId);
    expect(after?.total_points).toBe(0);
    expect(after?.tier).toBe("jigyasu");
    expect(result.orphanBalances).toBeGreaterThan(0);
    expect(result.samples.some((s) => s.student_id === studentId && s.orphan_balance)).toBe(true);
  });

  it("is a no-op on a consistent ledger, and says so", async () => {
    // Everything above has just been repaired, so a second pass must find nothing.
    const result = await reconcilePunyaBalances();
    expect(result.drifted).toBe(0);
    expect(result.repaired).toBe(0);
    expect(result.netPointsMoved).toBe(0);
    expect(result.scanned).toBeGreaterThan(0);
  });

  it("tier boundaries agree with TIER_THRESHOLDS", async () => {
    // The SQL CASE ladder in the reconcile duplicates tierForPoints' arithmetic.
    // Two implementations of one rule, previously with no test asserting they agree.
    const cases: Array<[number, string]> = [
      [0, "jigyasu"],
      [TIER_THRESHOLDS.shravak - 1, "jigyasu"],
      [TIER_THRESHOLDS.shravak, "shravak"],
      [TIER_THRESHOLDS.sadhak - 1, "shravak"],
      [TIER_THRESHOLDS.sadhak, "sadhak"],
      [TIER_THRESHOLDS.shraman - 1, "sadhak"],
      [TIER_THRESHOLDS.shraman, "shraman"],
      [TIER_THRESHOLDS.tirthankar - 1, "shraman"],
      [TIER_THRESHOLDS.tirthankar, "tirthankar"],
    ];

    for (const [points, expected] of cases) {
      const tag = `${Date.now().toString(36).slice(-5)}${points}`;
      const studentId = await plantStudent(tag);
      if (points > 0) {
        await db.insert(punya_transactions).values({
          student_id: studentId,
          feature_key: "manual_award",
          points,
          idempotency_key: `reconcile-tier-${tag}`,
        });
      }
      await db
        .insert(punya_balances)
        .values({ student_id: studentId, total_points: -1, tier: "jigyasu" })
        .onConflictDoUpdate({
          target: punya_balances.student_id,
          set: { total_points: -1, tier: "jigyasu" },
        });

      await reconcilePunyaBalances();
      const after = await readBalance(studentId);
      expect(after?.total_points, `points ${points}`).toBe(points);
      expect(after?.tier, `tier at ${points}`).toBe(expected);
    }
  });
});
