/**
 * GET /v1/admin/batches/:batchId/punya-standings — batch-scoped dense ranks.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { auth, loginAs } from "./helpers";
import { pool } from "@workspace/db";

afterAll(async () => {
  await pool.end();
});

async function outsiderBatchId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from batches where name = 'Tarun Batch - Unassigned Scope Fixture' limit 1`,
  );
  expect(rows[0]?.id).toBeTruthy();
  return rows[0]!.id;
}

/** Empty batch owned by the seeded shikshak so ranks are not polluted by seed students. */
async function plantScopedBatch(shikshakUserId: string): Promise<{ id: string; centre_id: string }> {
  const centre = await pool.query<{ id: string }>(
    `select b.centre_id as id
     from shikshak_batch_assignments sba
     join batches b on b.id = sba.batch_id
     where sba.user_id = $1 and sba.is_active = true
     limit 1`,
    [shikshakUserId],
  );
  expect(centre.rows[0]?.id).toBeTruthy();
  const centreId = centre.rows[0]!.id;
  const tag = Date.now().toString(36).slice(-6);
  const batch = await pool.query<{ id: string }>(
    `insert into batches (name, centre_id, age_groups, day_of_week, start_time, end_time)
     values ($1, $2, array['bal']::age_group_enum[], array[1]::int[], '09:00', '10:00')
     returning id`,
    [`Punya Standings Fixture ${tag}`, centreId],
  );
  const batchId = batch.rows[0]!.id;
  await pool.query(
    `insert into shikshak_batch_assignments (user_id, batch_id, is_active, is_primary)
     values ($1, $2, true, false)`,
    [shikshakUserId, batchId],
  );
  return { id: batchId, centre_id: centreId };
}

async function plantStudent(opts: {
  batchId: string;
  centreId: string;
  name: string;
  code: string;
  status?: string;
  totalPoints?: number;
  tier?: string;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into students (full_name, student_code, age_group, batch_id, centre_id, status)
     values ($1, $2, 'bal', $3, $4, $5)
     returning id`,
    [opts.name, opts.code, opts.batchId, opts.centreId, opts.status ?? "active"],
  );
  const id = rows[0]!.id;
  if (opts.totalPoints != null) {
    await pool.query(
      `insert into punya_balances (student_id, total_points, tier, updated_at)
       values ($1, $2, $3::tier_enum, now())
       on conflict (student_id) do update
         set total_points = excluded.total_points,
             tier = excluded.tier,
             updated_at = now()`,
      [id, opts.totalPoints, opts.tier ?? "jigyasu"],
    );
  }
  return id;
}

function currentMonthIst(): string {
  const istParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = istParts.find((p) => p.type === "year")!.value;
  const m = istParts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

describe("GET /v1/admin/batches/:batchId/punya-standings", () => {
  it("returns 404 when shikshak is not assigned to the batch", async () => {
    const shikshak = await loginAs("shikshak");
    const outsider = await outsiderBatchId();
    const res = await request(app)
      .get(`/v1/admin/batches/${outsider}/punya-standings`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });

  /**
   * The mobile screen (app/shikshak/punya.tsx via useBatchPunyaStandings) reads
   * `meta` for its header totals, but nothing asserted it — so the block could
   * drift or vanish without a test noticing.
   */
  it("returns meta totals that agree with the item rows", async () => {
    const shikshak = await loginAs("shikshak");
    const batch = await plantScopedBatch(shikshak.user.id);
    const tag = Date.now().toString(36).slice(-6);

    await plantStudent({
      batchId: batch.id,
      centreId: batch.centre_id,
      name: `Meta A ${tag}`,
      code: `MT-A-${tag}`,
      totalPoints: 120,
      tier: "shravak",
    });
    await plantStudent({
      batchId: batch.id,
      centreId: batch.centre_id,
      name: `Meta B ${tag}`,
      code: `MT-B-${tag}`,
      totalPoints: 80,
      tier: "jigyasu",
    });
    // Excluded from every aggregate, exactly as it is from the rows (Q11).
    await plantStudent({
      batchId: batch.id,
      centreId: batch.centre_id,
      name: `Meta Inactive ${tag}`,
      code: `MT-I-${tag}`,
      status: "inactive",
      totalPoints: 5000,
      tier: "tirthankar",
    });

    const res = await request(app)
      .get(`/v1/admin/batches/${batch.id}/punya-standings`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(200);

    const { items, meta } = res.body.data as {
      items: Array<{ total_points: number }>;
      meta: {
        batch_id: string;
        batch_name: string;
        month: string;
        student_count: number;
        batch_total: number;
        batch_average: number;
        tier_counts: Record<string, number>;
      };
    };

    expect(meta.batch_id).toBe(batch.id);
    expect(meta.month).toMatch(/^\d{4}-\d{2}$/);
    expect(meta.student_count).toBe(items.length);
    expect(meta.student_count).toBe(2);
    expect(meta.batch_total).toBe(items.reduce((sum, r) => sum + r.total_points, 0));
    expect(meta.batch_total).toBe(200);
    expect(meta.batch_average).toBe(100);
    // The inactive tirthankar must not appear in the tier histogram either.
    expect(meta.tier_counts.tirthankar ?? 0).toBe(0);
    expect(meta.tier_counts.shravak).toBe(1);
    expect(meta.tier_counts.jigyasu).toBe(1);
  });

  it("uses dense ranks for tied totals and excludes inactive students", async () => {
    const shikshak = await loginAs("shikshak");
    const batch = await plantScopedBatch(shikshak.user.id);
    const tag = Date.now().toString(36).slice(-6);

    const a = await plantStudent({
      batchId: batch.id,
      centreId: batch.centre_id,
      name: `Standings A ${tag}`,
      code: `ST-A-${tag}`,
      totalPoints: 100,
      tier: "jigyasu",
    });
    const b = await plantStudent({
      batchId: batch.id,
      centreId: batch.centre_id,
      name: `Standings B ${tag}`,
      code: `ST-B-${tag}`,
      totalPoints: 100,
      tier: "jigyasu",
    });
    const c = await plantStudent({
      batchId: batch.id,
      centreId: batch.centre_id,
      name: `Standings C ${tag}`,
      code: `ST-C-${tag}`,
      totalPoints: 50,
      tier: "jigyasu",
    });
    const inactive = await plantStudent({
      batchId: batch.id,
      centreId: batch.centre_id,
      name: `Standings Inactive ${tag}`,
      code: `ST-I-${tag}`,
      status: "inactive",
      totalPoints: 999,
      tier: "tirthankar",
    });

    const res = await request(app)
      .get(`/v1/admin/batches/${batch.id}/punya-standings`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(200);

    const items: Array<{ student_id: string; rank: number; total_points: number }> =
      res.body.data.items;
    expect(items).toHaveLength(3);
    const byId = new Map(items.map((row) => [row.student_id, row]));

    expect(byId.has(inactive)).toBe(false);
    expect(byId.get(a)?.rank).toBe(1);
    expect(byId.get(b)?.rank).toBe(1);
    expect(byId.get(c)?.rank).toBe(2);
  });

  it("nets month_points across awards and reversals; by_source sums match", async () => {
    const shikshak = await loginAs("shikshak");
    const batch = await plantScopedBatch(shikshak.user.id);
    const tag = Date.now().toString(36).slice(-6);
    const studentId = await plantStudent({
      batchId: batch.id,
      centreId: batch.centre_id,
      name: `Standings Net ${tag}`,
      code: `ST-N-${tag}`,
      totalPoints: 0,
    });

    const awardKey = `standings-net-award-${randomUUID()}`;
    // awarded_by stays NULL deliberately. These rows are a fixture for the
    // net/by_source assertions below and nothing here reads the awarder — but
    // pointsAwardedTodayBy counts every positive manual_award row an actor
    // holds today, so attributing them to the seeded shikshak spent 20 of
    // that shikshak's 50-point daily budget on every run and made
    // punya-award-limits.test.ts fail depending on file order.
    await pool.query(
      `insert into punya_transactions
         (student_id, feature_key, points, note, awarded_by, idempotency_key, created_at)
       values
         ($1, 'manual_award', 20, 'award', NULL, $2, now()),
         ($1, 'manual_award', -20, 'reverse', NULL, $3, now()),
         ($1, 'niyam', 15, 'niyam', NULL, $4, now())`,
      [
        studentId,
        awardKey,
        `${awardKey}:reversal`,
        `standings-niyam-${randomUUID()}`,
      ],
    );

    const monthKey = currentMonthIst();
    const res = await request(app)
      .get(`/v1/admin/batches/${batch.id}/punya-standings?month=${monthKey}`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(200);

    const row = res.body.data.items.find(
      (s: { student_id: string }) => s.student_id === studentId,
    );
    expect(row).toBeTruthy();
    expect(row.month_points).toBe(15);

    const bySource: Record<string, number> = row.by_source;
    const sourceSum = Object.values(bySource).reduce((a, b) => a + Number(b), 0);
    expect(sourceSum).toBe(row.month_points);
    expect(Number(bySource.manual_award ?? 0)).toBe(0);
    expect(Number(bySource.niyam ?? 0)).toBe(15);
  });
});
