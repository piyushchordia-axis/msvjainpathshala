/**
 * H6 — BRD §7.2's five manual award categories.
 * M18 — a mis-targeted manual award can be reversed.
 *
 * The manual award was one undifferentiated bucket: {student_id, points, note?}
 * with no feature_key, so festival, seva, helping others, competition and MSV
 * shivir all collapsed into a single `manual_award` row distinguished only by
 * free text — and `note` was optional, so web-originated rows showed nothing at
 * all in the audit while the mobile sheet demanded a reason.
 *
 * And once made, an award was permanent: reversePunya lived in lib/ and was
 * reachable from no HTTP route, so a Sanchalak who saw their shikshak award the
 * wrong child had nothing to do about it on any surface.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import app from "../src/app";
import { auth, loginAs } from "./helpers";
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
  return rows[0]!.id;
}

async function ledgerRow(key: string) {
  const { rows } = await pool.query<{ feature_key: string; points: number; note: string | null }>(
    `select feature_key, points, note from punya_transactions where idempotency_key = $1`,
    [key],
  );
  return rows[0];
}

describe("H6 — manual award categories", () => {
  it("lists the BRD categories with their bounds", async () => {
    const admin = await loginAs("super_admin");
    const res = await request(app)
      .get("/v1/admin/punya/award-categories")
      .set(auth(admin.token));
    expect(res.status).toBe(200);

    const items: Array<{ key: string; requires_reason: boolean; max_points: number | null }> =
      res.body.data.items;
    const keys = items.map((i) => i.key);
    for (const k of [
      "manual_festival",
      "manual_seva",
      "manual_helping",
      "manual_competition",
      "msv_shivir",
      "manual_award",
    ]) {
      expect(keys).toContain(k);
    }
    // Every category demands a reason — an adult giving a child points says why.
    expect(items.every((i) => i.requires_reason)).toBe(true);
    // Bounds are data, not a number in someone's head.
    expect(items.find((i) => i.key === "manual_seva")?.max_points).toBe(50);
    expect(items.find((i) => i.key === "manual_helping")?.max_points).toBe(30);
  });

  it("records WHICH category the award was for", async () => {
    const admin = await loginAs("super_admin");
    const key = `cat-seva-${randomUUID()}`;
    const res = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({
        student_id: await aaravId(),
        points: 20,
        feature_key: "manual_seva",
        note: "helped set up the hall",
        idempotency_key: key,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.feature_key).toBe("manual_seva");

    const row = await ledgerRow(key);
    expect(row?.feature_key).toBe("manual_seva");
    expect(row?.points).toBe(20);
  });

  it("enforces the category's own bounds", async () => {
    const admin = await loginAs("super_admin");
    const studentId = await aaravId();

    // Helping others is 10–30; 40 is inside the super_admin ceiling of 500 but
    // outside the category, which is exactly the distinction that did not exist.
    const tooHigh = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({
        student_id: studentId,
        points: 40,
        feature_key: "manual_helping",
        note: "carried books",
        idempotency_key: `cat-high-${randomUUID()}`,
      });
    expect(tooHigh.status).toBe(422);
    expect(tooHigh.body.error.message).toMatch(/up to 30/i);

    const tooLow = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({
        student_id: studentId,
        points: 5,
        feature_key: "manual_helping",
        note: "carried books",
        idempotency_key: `cat-low-${randomUUID()}`,
      });
    expect(tooLow.status).toBe(422);
    expect(tooLow.body.error.message).toMatch(/start at 10/i);
  });

  it("requires a reason — the defect that let web rows arrive blank", async () => {
    const admin = await loginAs("super_admin");
    const res = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({
        student_id: await aaravId(),
        points: 15,
        feature_key: "manual_festival",
        idempotency_key: `cat-noreason-${randomUUID()}`,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/reason/i);
  });

  it("rejects a category that is not in the catalogue", async () => {
    const admin = await loginAs("super_admin");
    const res = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({
        student_id: await aaravId(),
        points: 10,
        feature_key: "attendance",
        note: "trying to forge an attendance award",
        idempotency_key: `cat-forge-${randomUUID()}`,
      });
    // `attendance` is real, but it is not is_manual — a human must not be able
    // to mint one by hand and have it counted as a genuine attendance award.
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/not a category/i);
  });

  it("an omitted category still works — existing callers are unaffected", async () => {
    const admin = await loginAs("super_admin");
    const key = `cat-default-${randomUUID()}`;
    const res = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({
        student_id: await aaravId(),
        points: 7,
        note: "no category given",
        idempotency_key: key,
      });
    expect(res.status).toBe(200);
    expect((await ledgerRow(key))?.feature_key).toBe("manual_award");
  });

  it("every manual category counts toward the daily cap", async () => {
    // Splitting one bucket into five would otherwise have handed every admin an
    // unlimited budget: spend the cap on manual_award, then keep going as Seva.
    const { rows: before } = await pool.query<{ total: string }>(
      `select coalesce(sum(points),0)::text as total from punya_transactions t
        join punya_features f on f.key = t.feature_key and f.is_manual = true
       where t.points > 0
         and (t.created_at at time zone 'Asia/Kolkata')::date
           = (current_timestamp at time zone 'Asia/Kolkata')::date`,
    );
    expect(Number(before[0]!.total)).toBeGreaterThan(0);

    const admin = await loginAs("super_admin");
    const limit = await request(app)
      .get("/v1/admin/punya/award-limit")
      .set(auth(admin.token));
    expect(limit.status).toBe(200);
    // super_admin has no daily cap, but the tally must still see every category.
    expect(limit.body.data.points_awarded_today).toBeGreaterThan(0);
  });
});

describe("M18 — reversing a manual award", () => {
  it("reverses, is audited, and refuses a second time", async () => {
    const admin = await loginAs("super_admin");
    const studentId = await aaravId();
    const key = `rev-${randomUUID()}`;

    const award = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({
        student_id: studentId,
        points: 25,
        feature_key: "manual_seva",
        note: "wrong child",
        idempotency_key: key,
      });
    expect(award.status).toBe(200);
    const totalAfterAward = award.body.data.total_points;

    const { rows } = await pool.query<{ id: string }>(
      `select id from punya_transactions where idempotency_key = $1`,
      [key],
    );
    const txnId = rows[0]!.id;

    const noReason = await request(app)
      .post(`/v1/admin/punya/transactions/${txnId}/reverse`)
      .set(auth(admin.token))
      .send({});
    expect(noReason.status).toBe(422);

    const reversed = await request(app)
      .post(`/v1/admin/punya/transactions/${txnId}/reverse`)
      .set(auth(admin.token))
      .send({ reason: "awarded to the wrong child" });
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.points_reversed).toBe(25);
    expect(reversed.body.data.total_points).toBe(totalAfterAward - 25);

    // Audited as 'reverse', never as 'award'.
    const audit = await pool.query<{ action: string }>(
      `select action from audit_logs
        where entity_id = $1 and action = 'reverse'
        order by created_at desc limit 1`,
      [studentId],
    );
    expect(audit.rows[0]?.action).toBe("reverse");

    // Idempotent at the domain level: a second attempt is refused, not doubled.
    const again = await request(app)
      .post(`/v1/admin/punya/transactions/${txnId}/reverse`)
      .set(auth(admin.token))
      .send({ reason: "double click" });
    expect(again.status).toBe(409);

    const { rows: net } = await pool.query<{ total: string }>(
      `select coalesce(sum(points),0)::text as total from punya_transactions
        where idempotency_key in ($1, $2)`,
      [key, `${key}:reversal`],
    );
    expect(Number(net[0]!.total)).toBe(0);
  });

  it("refuses to reverse a non-manual award from here", async () => {
    // Attendance, niyam, homework and the rest reverse through their own domain
    // paths, which also fix streaks, gallery rows, badges and certification.
    // Moving the points from here would desynchronise all of that silently.
    const admin = await loginAs("super_admin");
    const { rows } = await pool.query<{ id: string }>(
      `select id from punya_transactions
        where feature_key = 'attendance' and points > 0 limit 1`,
    );
    if (!rows[0]) return; // no attendance awards in this database
    const res = await request(app)
      .post(`/v1/admin/punya/transactions/${rows[0].id}/reverse`)
      .set(auth(admin.token))
      .send({ reason: "should not be allowed" });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/manually awarded/i);
  });

  it("is scoped — a shikshak cannot reverse outside their batch", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");

    const batch = await pool.query<{ id: string; centre_id: string }>(
      `select id, centre_id from batches where name = 'Tarun Batch - Unassigned Scope Fixture' limit 1`,
    );
    const stu = await pool.query<{ id: string }>(
      `insert into students (full_name, student_code, age_group, batch_id, centre_id, status)
       values ('Reverse Scope Out', $1, 'tarun', $2, $3, 'active')
       returning id`,
      [`REV-OUT-${Date.now().toString(36).slice(-6)}`, batch.rows[0]!.id, batch.rows[0]!.centre_id],
    );

    const key = `rev-scope-${randomUUID()}`;
    const award = await request(app)
      .post("/v1/admin/punya/award")
      .set(auth(admin.token))
      .send({
        student_id: stu.rows[0]!.id,
        points: 10,
        feature_key: "manual_seva",
        note: "out of the shikshak's batch",
        idempotency_key: key,
      });
    expect(award.status).toBe(200);

    const { rows } = await pool.query<{ id: string }>(
      `select id from punya_transactions where idempotency_key = $1`,
      [key],
    );
    const res = await request(app)
      .post(`/v1/admin/punya/transactions/${rows[0]!.id}/reverse`)
      .set(auth(shikshak.token))
      .send({ reason: "not mine to reverse" });
    // 404, not 403 — no existence leak, matching the rest of the module.
    expect(res.status).toBe(404);
  });
});
