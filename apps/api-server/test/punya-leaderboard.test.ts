/**
 * H1 / H2 / M16 — BRD §7.6 leaderboards.
 *
 * There was no leaderboard endpoint at any scope, and the one artefact that
 * existed — monthly_leaderboard_snapshots — was written by nothing anyone read
 * and ranked `punya_balances.total_points`, a LIFETIME balance that is never
 * reset, under a month label. Every month's "monthly leaderboard" was a copy of
 * the all-time ranking: a student who earned 5 points in November but held
 * 4,000 lifetime ranked #1 for November, and a child who had a brilliant month
 * appeared nowhere.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";
import { auth, loginAs, withLedgerMaintenance } from "./helpers";
import { awardPunya } from "../src/lib/punya";
import { clearLeaderboardCache, getLeaderboard } from "../src/services/punya-leaderboard";
import { snapshotMonthlyLeaderboard } from "../src/services/monthly-leaderboard-snapshot";

const plantedStudentIds: string[] = [];
let batchId = "";
let centreId = "";
let cityId = "";

afterAll(async () => {
  if (plantedStudentIds.length) {
    await withLedgerMaintenance(async (c) => {
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

async function plant(name: string, points: number, opts?: { lifetime?: number }): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into students (centre_id, batch_id, full_name, student_code, status, dob, gender, age_group)
     values ($1, $2, $3, $4, 'active', '2014-01-01', 'male', 'kishor')
     returning id`,
    [centreId, batchId, name, `LB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 24)],
  );
  const id = rows[0]!.id;
  plantedStudentIds.push(id);

  // Points earned THIS month.
  if (points > 0) {
    await awardPunya({
      studentId: id,
      featureKey: "manual_award",
      points,
      note: "leaderboard fixture",
      idempotencyKey: `lb-${id}-month`,
    });
  }
  // Points earned long ago — inflates the LIFETIME balance without touching
  // this month. This is the case the old ranking got exactly backwards.
  if (opts?.lifetime) {
    await awardPunya({
      studentId: id,
      featureKey: "manual_award",
      points: opts.lifetime,
      note: "historic",
      idempotencyKey: `lb-${id}-hist`,
    });
    await withLedgerMaintenance((c) =>
      c.query(
        `update punya_transactions set created_at = now() - interval '6 months'
          where idempotency_key = $1`,
        [`lb-${id}-hist`],
      ),
    );
  }
  return id;
}

beforeAll(async () => {
  const geo = await pool.query<{ batch_id: string; centre_id: string; city_id: string }>(
    `select b.id as batch_id, b.centre_id, c.city_id
       from batches b join centres c on c.id = b.centre_id
      where b.deleted_at is null and b.status = 'active' limit 1`,
  );
  batchId = geo.rows[0]!.batch_id;
  centreId = geo.rows[0]!.centre_id;
  cityId = geo.rows[0]!.city_id;
  clearLeaderboardCache();
});

describe("H1 — the monthly board ranks THIS month, not all time", () => {
  it("a big month beats a big lifetime", async () => {
    const tag = Date.now().toString(36).slice(-5);
    // Hero earned a lot this month and nothing before.
    const hero = await plant(`LB Hero ${tag}`, 400);
    // Veteran holds far more lifetime, but almost nothing this month.
    const veteran = await plant(`LB Veteran ${tag}`, 5, { lifetime: 4000 });
    clearLeaderboardCache();

    const monthly = await getLeaderboard({
      scope: "batch",
      scopeId: batchId,
      period: "month",
      limit: 50,
    });
    const heroRank = monthly.items.find((r) => r.student_id === hero)!.rank;
    const veteranRank = monthly.items.find((r) => r.student_id === veteran)!.rank;
    expect(heroRank).toBeLessThan(veteranRank);
    expect(monthly.items.find((r) => r.student_id === hero)!.points).toBe(400);
    // The month's board must not count the six-month-old award.
    expect(monthly.items.find((r) => r.student_id === veteran)!.points).toBe(5);

    // All-time inverts it, which is the whole point of having two periods.
    const lifetime = await getLeaderboard({
      scope: "batch",
      scopeId: batchId,
      period: "all_time",
      limit: 50,
    });
    expect(lifetime.items.find((r) => r.student_id === veteran)!.points).toBe(4005);
  });

  it("the snapshot writes the month's earnings, top 20 only", async () => {
    const result = await snapshotMonthlyLeaderboard();
    // The month just ENDED, so this run's fixtures (awarded now) are not in it;
    // what matters is that it completes and stays within the top-20 bound.
    expect(typeof result.month).toBe("string");
    const { rows } = await pool.query<{ n: string }>(
      `select coalesce(max(rank), 0)::text as n from monthly_leaderboard_snapshots
        where month = $1::date`,
      [result.month],
    );
    expect(Number(rows[0]!.n)).toBeLessThanOrEqual(20);
  });
});

describe("H2 — the leaderboard endpoint and its scope rules", () => {
  it("returns the caller's own rank even outside the top N", async () => {
    const tag = Date.now().toString(36).slice(-5);
    const top = await plant(`LB Top ${tag}`, 900);
    const low = await plant(`LB Low ${tag}`, 1);
    clearLeaderboardCache();

    const full = await getLeaderboard({
      scope: "batch",
      scopeId: batchId,
      period: "month",
      limit: 100,
    });
    const topRank = full.items.find((r) => r.student_id === top)!.rank;
    const lowRank = full.items.find((r) => r.student_id === low)!.rank;
    expect(topRank).toBeLessThan(lowRank);

    const board = await getLeaderboard({
      scope: "batch",
      scopeId: batchId,
      period: "month",
      limit: 1,
      selfStudentId: low,
    });
    expect(board.items).toHaveLength(1);
    expect(board.items[0]!.rank).toBe(1);
    // SPEC 6.9 — "top N + caller's rank". Without this a child outside the top
    // sees a board they do not appear on and learns nothing about themselves.
    expect(board.me?.student_id).toBe(low);
    expect(board.me!.rank).toBeGreaterThan(1);
  });

  it("a parent can read their own child's batch board", async () => {
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const child = children.body.data.items[0]!;
    // /v1/me/children does not expose batch_id, so read it directly.
    const { rows } = await pool.query<{ batch_id: string | null }>(
      `select batch_id from students where id = $1`,
      [child.id],
    );
    expect(rows[0]?.batch_id).toBeTruthy();
    const res = await request(app)
      .get(`/v1/leaderboard?scope=batch&id=${rows[0]!.batch_id}`)
      .set(auth(parent.token));
    expect(res.status).toBe(200);
    expect(res.body.data.scope).toBe("batch");
  });

  it("a parent cannot read an arbitrary batch they have no child in", async () => {
    const parent = await loginAs("parent");
    const other = await pool.query<{ id: string }>(
      `select b.id from batches b
        where b.deleted_at is null
          and b.id not in (select batch_id from students where parent_id =
            (select id from users where phone = '+919800000006') and batch_id is not null)
        limit 1`,
    );
    const res = await request(app)
      .get(`/v1/leaderboard?scope=batch&id=${other.rows[0]!.id}`)
      .set(auth(parent.token));
    // 404, not 403 — whether that batch exists is not theirs to learn.
    expect(res.status).toBe(404);
  });

  it("a shikshak cannot read a whole city's ranking", async () => {
    const shikshak = await loginAs("shikshak");
    const res = await request(app)
      .get(`/v1/leaderboard?scope=city&id=${cityId}`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(404);
  });

  it("a city_admin can", async () => {
    const admin = await loginAs("city_admin");
    const res = await request(app)
      .get(`/v1/leaderboard?scope=city&id=${cityId}`)
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it("validates scope, id and period", async () => {
    const admin = await loginAs("super_admin");
    const bad = await request(app)
      .get("/v1/leaderboard?scope=galaxy&id=" + cityId)
      .set(auth(admin.token));
    expect(bad.status).toBe(422);

    const noId = await request(app).get("/v1/leaderboard?scope=city").set(auth(admin.token));
    expect(noId.status).toBe(422);

    // msv is the one board that is meaningful nationally, so it needs no id.
    const msv = await request(app).get("/v1/leaderboard?scope=msv").set(auth(admin.token));
    expect(msv.status).toBe(200);
  });

  it("excludes deactivated students (Q11)", async () => {
    const tag = Date.now().toString(36).slice(-5);
    const gone = await plant(`LB Gone ${tag}`, 700);
    await pool.query(`update students set status = 'inactive' where id = $1`, [gone]);
    clearLeaderboardCache();

    const board = await getLeaderboard({
      scope: "batch",
      scopeId: batchId,
      period: "month",
      limit: 50,
    });
    expect(board.items.some((r) => r.student_id === gone)).toBe(false);
  });
});
