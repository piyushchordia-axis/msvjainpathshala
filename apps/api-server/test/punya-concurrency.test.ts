/**
 * H7 — the daily award cap under concurrency.
 *
 * The cap was a read-check-write straddling three separate connections: the
 * route read `points_awarded_today` on the pool, compared it on the pool, then
 * called awardPunya, which opened its OWN transaction. Two awards of 10 issued
 * at 40/50 used both read 40, both passed the check, and both committed — 60
 * against a 50 cap. There was no row lock, no advisory lock, no post-award
 * verification, and the nightly reconcile rebuilds balances FROM the ledger, so
 * nothing would ever have flagged it.
 *
 * The existing daily-cap case in punya-award-limits.test.ts drains the budget
 * strictly sequentially in an `await` loop, so it cannot detect this by
 * construction. This file issues genuinely concurrent requests.
 *
 * Rather than deleting ledger rows to get a clean budget (the ledger is
 * append-only), each test narrows the role's cap to a known distance above
 * whatever has already been spent today, then restores it.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { auth, loginAs } from "./helpers";
import { pool } from "@workspace/db";
import { clearAwardLimitCache } from "../src/lib/punya-award-limits";

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  clearAwardLimitCache();
});

const ROLE = "city_admin";

async function spentToday(awardedBy: string): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `select coalesce(sum(points), 0)::text as total from punya_transactions
     where awarded_by = $1 and feature_key = 'manual_award' and points > 0
       and (created_at at time zone 'Asia/Kolkata')::date
         = (current_timestamp at time zone 'Asia/Kolkata')::date`,
    [awardedBy],
  );
  return Number(rows[0]!.total);
}

async function readLimits(): Promise<{ perAward: number; perDay: number | null }> {
  const { rows } = await pool.query<{ a: number; d: number | null }>(
    `select max_points_per_award as a, max_points_per_day as d
       from punya_award_limits where role = $1`,
    [ROLE],
  );
  return { perAward: rows[0]!.a, perDay: rows[0]!.d };
}

/**
 * Give this run `headroom` points of budget above whatever today already
 * holds, then restore.
 *
 * The ledger is append-only (0090) so an earlier run's spend cannot be
 * deleted, the daily cap is now genuinely enforced (H7), and EVERY manual
 * category counts toward it (H6) — so without this the second run of any
 * day fails on a 429 that has nothing to do with what is being tested.
 */
async function withDailyHeadroom(
  userId: string,
  headroom: number,
  fn: () => Promise<void>,
): Promise<void> {
  const original = await readLimits();
  const spent = await spentToday(userId);
  await writeLimits(original.perAward, spent + headroom);
  try {
    await fn();
  } finally {
    await writeLimits(original.perAward, original.perDay);
  }
}

async function writeLimits(perAward: number, perDay: number | null): Promise<void> {
  await pool.query(
    `update punya_award_limits set max_points_per_award = $2, max_points_per_day = $3
      where role = $1`,
    [ROLE, perAward, perDay],
  );
  clearAwardLimitCache();
}

async function aaravId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from students
     where full_name = 'Aarav Shah' and student_code like 'MUM-%' and deleted_at is null
     limit 1`,
  );
  expect(rows[0]?.id).toBeTruthy();
  return rows[0]!.id;
}

describe("H7 — daily award cap is race-safe", () => {
  it("concurrent awards cannot exceed max_points_per_day", async () => {
    const admin = await loginAs(ROLE);
    const studentId = await aaravId();
    const original = await readLimits();

    try {
      const already = await spentToday(admin.user.id);
      // Exactly two 10-point awards fit in the remaining budget.
      await writeLimits(10, already + 20);

      const CONCURRENT = 6;
      const responses = await Promise.all(
        Array.from({ length: CONCURRENT }, () =>
          request(app)
            .post("/v1/admin/punya/award")
            .set(auth(admin.token))
            .send({
              student_id: studentId,
              points: 10,
              note: "h7 concurrency probe",
              idempotency_key: `h7-${randomUUID()}`,
            }),
        ),
      );

      const accepted = responses.filter((r) => r.status === 200);
      const refused = responses.filter((r) => r.status === 429);

      // Every request must be decided — no 500s from lock contention.
      expect(accepted.length + refused.length).toBe(CONCURRENT);
      expect(refused.every((r) => r.body.error.code === "ERR_AWARD_DAILY_LIMIT_EXCEEDED")).toBe(
        true,
      );

      // The invariant that actually matters: the ledger never exceeds the cap.
      const after = await spentToday(admin.user.id);
      expect(after).toBeLessThanOrEqual(already + 20);
      // ...and the budget was genuinely used, not merely never touched.
      expect(accepted.length).toBe(2);
      expect(after).toBe(already + 20);
    } finally {
      await writeLimits(original.perAward, original.perDay);
    }
  });

  it("concurrent replays of one idempotency_key credit exactly once", async () => {
    const admin = await loginAs(ROLE);
    const studentId = await aaravId();
    const key = `h7-idem-${randomUUID()}`;

    await withDailyHeadroom(admin.user.id, 50, async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app)
            .post("/v1/admin/punya/award")
            .set(auth(admin.token))
            .send({
              student_id: studentId,
              points: 4,
              note: "manual award needs a reason (H6)",
              idempotency_key: key,
            }),
        ),
      );
      expect(responses.every((r) => r.status === 200)).toBe(true);

      const { rows } = await pool.query<{ n: string }>(
        `select count(*)::text as n from punya_transactions where idempotency_key = $1`,
        [key],
      );
      expect(Number(rows[0]!.n)).toBe(1);
    });
  });

  it("M15 — another actor's idempotency_key does not bypass the cap", async () => {
    // The replay lookup matched on idempotency_key alone, so quoting a key that
    // belonged to a different awarder marked the request a "replay" and skipped
    // BOTH limit checks — and returned that other transaction's points.
    const admin = await loginAs(ROLE);
    const shikshak = await loginAs("shikshak");
    const studentId = await aaravId();
    const original = await readLimits();

    try {
      // Headroom first: this test is about the per-award ceiling and cross-actor
      // keys, not about whatever the day's budget happens to hold.
      await writeLimits(original.perAward, (await spentToday(admin.user.id)) + 200);
      const key = `h7-cross-${randomUUID()}`;
      const seed = await request(app)
        .post("/v1/admin/punya/award")
        .set(auth(admin.token))
        .send({
          student_id: studentId,
          points: 5,
          note: "manual award needs a reason (H6)",
          idempotency_key: key,
        });
      expect(seed.status).toBe(200);

      // Drop the city_admin per-award ceiling below what we now try to award.
      await writeLimits(1, original.perDay);

      const abuse = await request(app)
        .post("/v1/admin/punya/award")
        .set(auth(admin.token))
        .send({
          student_id: studentId,
          points: 100,
          note: "manual award needs a reason (H6)",
          idempotency_key: key,
        });
      // Same actor + same student + same key IS a legitimate replay: 200, no credit.
      expect(abuse.status).toBe(200);

      // A DIFFERENT actor quoting the key must not be treated as a replay.
      const other = await request(app)
        .post("/v1/admin/punya/award")
        .set(auth(shikshak.token))
        .send({
          student_id: studentId,
          points: 100,
          note: "manual award needs a reason (H6)",
          idempotency_key: key,
        });
      expect(other.status).toBe(422);
      expect(other.body.error.code).toBe("ERR_AWARD_LIMIT_EXCEEDED");

      const { rows } = await pool.query<{ n: string }>(
        `select count(*)::text as n from punya_transactions where idempotency_key = $1`,
        [key],
      );
      expect(Number(rows[0]!.n)).toBe(1);
    } finally {
      await writeLimits(original.perAward, original.perDay);
    }
  });
});
