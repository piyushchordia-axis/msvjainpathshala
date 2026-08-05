/**
 * POST /v1/admin/punya/award — batch scope + role award limits.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

async function aaravId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from students
     where full_name = 'Aarav Shah' and student_code like 'MUM-%' and deleted_at is null
     limit 1`,
  );
  expect(rows[0]?.id).toBeTruthy();
  return rows[0]!.id;
}

async function plantOutOfBatchStudent(): Promise<string> {
  const batch = await pool.query<{ id: string; centre_id: string }>(
    `select id, centre_id from batches where name = 'Tarun Batch - Unassigned Scope Fixture' limit 1`,
  );
  expect(batch.rows[0]).toBeTruthy();
  const { rows } = await pool.query<{ id: string }>(
    `insert into students (full_name, student_code, age_group, batch_id, centre_id, status)
     values ('Award Scope Out', $1, 'tarun', $2, $3, 'active')
     returning id`,
    [`AWARD-OUT-${Date.now().toString(36).slice(-6)}`, batch.rows[0]!.id, batch.rows[0]!.centre_id],
  );
  return rows[0]!.id;
}

async function ledgerRowsToday(awardedBy: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from punya_transactions
     where awarded_by = $1 and feature_key = 'manual_award' and points > 0
       and (created_at at time zone 'Asia/Kolkata')::date
         = (current_timestamp at time zone 'Asia/Kolkata')::date`,
    [awardedBy],
  );
  return Number(rows[0]!.n);
}

async function sumManualToday(awardedBy: string): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `select coalesce(sum(points), 0)::text as total from punya_transactions
     where awarded_by = $1 and feature_key = 'manual_award' and points > 0
       and (created_at at time zone 'Asia/Kolkata')::date
         = (current_timestamp at time zone 'Asia/Kolkata')::date`,
    [awardedBy],
  );
  return Number(rows[0]!.total);
}

describe("POST /v1/admin/punya/award — scope + limits", () => {
  beforeAll(async () => {
    // Ensure migration seed rows exist even if DB was migrated without re-seed.
    await pool.query(`
      INSERT INTO punya_features (key, label, min_points, max_points, is_active)
      SELECT 'manual_award', 'Manual admin award', 0, 500, true
      WHERE NOT EXISTS (SELECT 1 FROM punya_features WHERE key = 'manual_award');
      INSERT INTO punya_award_limits (role, max_points_per_award, max_points_per_day, is_active)
      SELECT v.role, v.max_award, v.max_day, true
      FROM (VALUES
        ('shikshak', 10, 50),
        ('sanchalak', 25, 150),
        ('city_admin', 100, 500),
        ('state_admin', 250, 1000),
        ('super_admin', 500, NULL::int)
      ) AS v(role, max_award, max_day)
      WHERE NOT EXISTS (SELECT 1 FROM punya_award_limits WHERE role = v.role);
    `);
  });

  it("GET /v1/admin/punya/award-limit returns role ceilings", async () => {
    const shikshak = await loginAs("shikshak");
    const res = await request(app).get("/v1/admin/punya/award-limit").set(auth(shikshak.token));
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("shikshak");
    expect(res.body.data.max_points_per_award).toBe(10);
    expect(res.body.data.max_points_per_day).toBe(50);
    expect(typeof res.body.data.points_awarded_today).toBe("number");
    expect(typeof res.body.data.remaining_today).toBe("number");
  });

  it("shikshak awarding to a student in their assigned batch succeeds", async () => {
    const shikshak = await loginAs("shikshak");
    const studentId = await aaravId();
    const res = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(shikshak.token))
      .send({ student_id: studentId, points: 5, note: "scope ok" });
    expect(res.status).toBe(200);
    expect(res.body.data.points_awarded).toBe(5);
    expect(res.body.data.student_id).toBe(studentId);
  });

  it("shikshak awarding to same-centre batch they do NOT teach gets 404", async () => {
    const shikshak = await loginAs("shikshak");
    const outsiderId = await plantOutOfBatchStudent();
    const res = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(shikshak.token))
      .send({ student_id: outsiderId, points: 5 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("sanchalak awarding anywhere in their centre still succeeds", async () => {
    const sanchalak = await loginAs("sanchalak");
    const outsiderId = await plantOutOfBatchStudent();
    const res = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(sanchalak.token))
      .send({ student_id: outsiderId, points: 10, note: "centre ok" });
    expect(res.status).toBe(200);
    expect(res.body.data.points_awarded).toBe(10);
  });

  it("points above the role max_points_per_award → 422 ERR_AWARD_LIMIT_EXCEEDED", async () => {
    const shikshak = await loginAs("shikshak");
    const studentId = await aaravId();
    const res = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(shikshak.token))
      .send({ student_id: studentId, points: 11 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_AWARD_LIMIT_EXCEEDED");
    expect(res.body.error.message).toMatch(/limit is 10/i);
  });

  it("awards that cross max_points_per_day → 429; ledger keeps only accepted ones", async () => {
    const shikshak = await loginAs("shikshak");
    const studentId = await aaravId();

    // Drain remaining daily budget with 10-point awards (shikshak day cap = 50).
    const before = await sumManualToday(shikshak.user.id);
    let spent = before;
    while (spent + 10 <= 50) {
      const r = await request(app)
        .post("/v1/admin/punya/award")
        .set(auth(shikshak.token))
        .send({
          student_id: studentId,
          points: 10,
          idempotency_key: `daily-fill-${randomUUID()}`,
        });
      expect(r.status).toBe(200);
      spent += 10;
    }

    const acceptedBefore = await ledgerRowsToday(shikshak.user.id);
    const blocked = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(shikshak.token))
      .send({ student_id: studentId, points: 10, idempotency_key: `daily-block-${randomUUID()}` });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("ERR_AWARD_DAILY_LIMIT_EXCEEDED");

    const acceptedAfter = await ledgerRowsToday(shikshak.user.id);
    expect(acceptedAfter).toBe(acceptedBefore);
    expect(await sumManualToday(shikshak.user.id)).toBeLessThanOrEqual(50);
  });

  it("replaying the same idempotency_key credits once", async () => {
    // Prefer city_admin (higher day cap) so this regression is independent of the daily test.
    const admin = await loginAs("city_admin");
    const studentId = await aaravId();
    const key = `idem-award-${randomUUID()}`;

    const first = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({ student_id: studentId, points: 3, idempotency_key: key });
    expect(first.status).toBe(200);
    const totalAfterFirst = first.body.data.total_points;

    const second = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({ student_id: studentId, points: 3, idempotency_key: key });
    expect(second.status).toBe(200);
    expect(second.body.data.total_points).toBe(totalAfterFirst);

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from punya_transactions where idempotency_key = $1`,
      [key],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
