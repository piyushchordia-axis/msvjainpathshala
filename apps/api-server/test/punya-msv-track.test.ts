/**
 * M1 / M2 — the MSV parallel track had no data model at all.
 *
 * SPEC §5.7 specifies city_id / centre_id / batch_id denormalised onto
 * punya_transactions "for fast leaderboard queries", is_msv_track for the
 * parallel MSV leaderboard, and msv_points on punya_balances. None existed, so
 * BRD §7.5's MSV tier labels and §7.6's MSV leaderboard had nothing to build on
 * and every scoped leaderboard would have joined students → centres → cities on
 * every read.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, db, punya_balances } from "@workspace/db";
import { eq } from "drizzle-orm";
import { withLedgerMaintenance } from "./helpers";
import { awardPunya, reversePunya } from "../src/lib/punya";
import { clearPunyaContextCache } from "../src/lib/punya-context";

const plantedStudentIds: string[] = [];

afterAll(async () => {
  if (plantedStudentIds.length) {
    await withLedgerMaintenance(async (c) => {
      await c.query(`delete from msv_enrolments where student_id = any($1::uuid[])`, [
        plantedStudentIds,
      ]);
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
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

async function plantStudent(tag: string, msv: boolean) {
  const pick = await pool.query<{ batch_id: string; centre_id: string; city_id: string }>(
    `select b.id as batch_id, b.centre_id, c.city_id
       from batches b join centres c on c.id = b.centre_id
      where b.deleted_at is null and b.status = 'active' limit 1`,
  );
  const geo = pick.rows[0]!;
  const { rows } = await pool.query<{ id: string }>(
    `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
     values ($1, $2, $3, $4, 'active', '2014-01-01', 'male', 'kishor')
     returning id`,
    [geo.centre_id, geo.batch_id, `MSVTrack ${tag}`, `MT${tag}`.slice(0, 24)],
  );
  const id = rows[0]!.id;
  plantedStudentIds.push(id);
  if (msv) {
    await pool.query(
      `insert into msv_enrolments (student_id, status) values ($1, 'approved')`,
      [id],
    );
  }
  clearPunyaContextCache();
  return { id, ...geo };
}

async function ledgerRow(key: string) {
  const { rows } = await pool.query<{
    city_id: string | null;
    centre_id: string | null;
    batch_id: string | null;
    is_msv_track: boolean;
    awarded_at: string | null;
  }>(
    `select city_id, centre_id, batch_id, is_msv_track, awarded_at
       from punya_transactions where idempotency_key = $1`,
    [key],
  );
  return rows[0];
}

async function balance(studentId: string) {
  const [row] = await db
    .select({ total_points: punya_balances.total_points, msv_points: punya_balances.msv_points })
    .from(punya_balances)
    .where(eq(punya_balances.student_id, studentId))
    .limit(1);
  return row;
}

describe("M1 — geography is snapshotted onto every ledger row", () => {
  it("an award carries city, centre, batch and awarded_at", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}`;
    const stu = await plantStudent(tag, false);
    const key = `msv-geo-${tag}`;
    await awardPunya({
      studentId: stu.id,
      featureKey: "manual_award",
      points: 12,
      note: "geo probe",
      idempotencyKey: key,
    });

    const row = await ledgerRow(key);
    expect(row?.city_id).toBe(stu.city_id);
    expect(row?.centre_id).toBe(stu.centre_id);
    expect(row?.batch_id).toBe(stu.batch_id);
    expect(row?.awarded_at).not.toBeNull();
    expect(row?.is_msv_track).toBe(false);
  });

  it("a reversal inherits the same context, so scoped sums net off", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}r`;
    const stu = await plantStudent(tag, true);
    const key = `msv-rev-${tag}`;
    await awardPunya({
      studentId: stu.id,
      featureKey: "manual_award",
      points: 30,
      note: "will be reversed",
      idempotencyKey: key,
    });
    await reversePunya({
      studentId: stu.id,
      featureKey: "manual_award",
      points: 30,
      note: "reversed",
      idempotencyKey: `${key}:reversal`,
    });

    const debit = await ledgerRow(`${key}:reversal`);
    // Written without these, the debit would not net off in any scoped or MSV
    // leaderboard and the clawed-back points would count forever.
    expect(debit?.centre_id).toBe(stu.centre_id);
    expect(debit?.city_id).toBe(stu.city_id);
    expect(debit?.is_msv_track).toBe(true);

    const { rows } = await pool.query<{ total: string }>(
      `select coalesce(sum(points),0)::text as total from punya_transactions
        where student_id = $1 and is_msv_track = true`,
      [stu.id],
    );
    expect(Number(rows[0]!.total)).toBe(0);
  });
});

describe("M2 — msv_points tracks the MSV share of the balance", () => {
  it("only an MSV student's awards move msv_points", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}m`;
    const msvStudent = await plantStudent(`${tag}a`, true);
    const plain = await plantStudent(`${tag}b`, false);

    await awardPunya({
      studentId: msvStudent.id,
      featureKey: "manual_award",
      points: 40,
      note: "msv award",
      idempotencyKey: `msv-pts-${tag}a`,
    });
    await awardPunya({
      studentId: plain.id,
      featureKey: "manual_award",
      points: 40,
      note: "non-msv award",
      idempotencyKey: `msv-pts-${tag}b`,
    });

    expect(await balance(msvStudent.id)).toEqual({ total_points: 40, msv_points: 40 });
    expect(await balance(plain.id)).toEqual({ total_points: 40, msv_points: 0 });
  });

  it("a reversal nets msv_points back down", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}n`;
    const stu = await plantStudent(tag, true);
    const key = `msv-net-${tag}`;
    await awardPunya({
      studentId: stu.id,
      featureKey: "manual_award",
      points: 25,
      note: "msv award",
      idempotencyKey: key,
    });
    expect(await balance(stu.id)).toEqual({ total_points: 25, msv_points: 25 });

    await reversePunya({
      studentId: stu.id,
      featureKey: "manual_award",
      points: 25,
      note: "undo",
      idempotencyKey: `${key}:reversal`,
    });
    // Without the MSV delta on the debit, msv_points would stay at 25 forever
    // while total_points correctly returned to 0.
    expect(await balance(stu.id)).toEqual({ total_points: 0, msv_points: 0 });
  });

  it("the reconcile repairs msv_points as well as total_points", async () => {
    const tag = `${Date.now().toString(36).slice(-6)}x`;
    const stu = await plantStudent(tag, true);
    await awardPunya({
      studentId: stu.id,
      featureKey: "manual_award",
      points: 60,
      note: "msv award",
      idempotencyKey: `msv-rec-${tag}`,
    });

    // Corrupt only msv_points — total_points stays correct, so a reconcile that
    // looked at the total alone would report "no drift" and leave it wrong.
    await db
      .update(punya_balances)
      .set({ msv_points: 999 })
      .where(eq(punya_balances.student_id, stu.id));

    const { reconcilePunyaBalances } = await import("../src/services/punya-reconcile");
    const result = await reconcilePunyaBalances();
    expect(result.drifted).toBeGreaterThan(0);

    expect(await balance(stu.id)).toEqual({ total_points: 60, msv_points: 60 });
  });
});
