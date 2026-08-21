/**
 * H4 / M5 — crossing into a new Punya tier produced nothing.
 *
 * Not because the celebration was unimplemented, but because the information
 * had already been discarded: creditBalance computed the new tier in SQL and
 * returned only total_points, so the OLD tier was unavailable by construction.
 * punya_balances had no tier_reached_at, there was no punya/tier notification
 * kind, and no endpoint returned the thresholds — so "how far to the next tier"
 * could not be rendered by any client even if one had tried.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool, db, punya_balances } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { auth, loginAs, withLedgerMaintenance } from "./helpers";
import { awardPunya, reversePunya } from "../src/lib/punya";
import { resolveTierThresholds } from "../src/lib/punya-tiers";
import { isTierUpgrade } from "../src/lib/punya-tier-notify";

const plantedStudentIds: string[] = [];

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

async function plantChildOfSeededParent(tag: string): Promise<string> {
  const parent = await pool.query<{ id: string }>(
    `select id from users where phone = '+919800000006' limit 1`,
  );
  const geo = await pool.query<{ batch_id: string; centre_id: string }>(
    `select b.id as batch_id, b.centre_id from batches b
      where b.deleted_at is null and b.status = 'active' limit 1`,
  );
  const { rows } = await pool.query<{ id: string }>(
    `insert into students (centre_id, batch_id, parent_id, full_name, student_code, status, dob, gender, age_group)
     values ($1, $2, $3, $4, $5, 'active', '2014-01-01', 'female', 'kishor')
     returning id`,
    [
      geo.rows[0]!.centre_id,
      geo.rows[0]!.batch_id,
      parent.rows[0]!.id,
      `TierUp ${tag}`,
      `TU${tag}`.slice(0, 24),
    ],
  );
  plantedStudentIds.push(rows[0]!.id);
  return rows[0]!.id;
}

/**
 * The inbox row carries no payload column — `data` is the push payload only —
 * so a tier notification is identified by kind plus the child's name in the
 * title, which is what the parent actually sees.
 */
async function tierNotifications(studentName: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from notifications
      where kind = 'punya_tier' and title_en like $1`,
    [`%${studentName}%`],
  );
  return Number(rows[0]!.n);
}

describe("H4 — a tier transition is detectable", () => {
  it("an award reports the tier it moved FROM", async () => {
    const t = await resolveTierThresholds();
    const studentId = await plantChildOfSeededParent(`${Date.now().toString(36).slice(-6)}`);

    const first = await awardPunya({
      studentId,
      featureKey: "manual_award",
      points: t.shravak - 1,
      note: "just below the bar",
      idempotencyKey: `tierup-a-${studentId}`,
    });
    expect(first.tier).toBe("jigyasu");
    // No row existed, so the student had zero points — which is Jigyasu, not
    // "unknown". Reporting null made a first award that vaults a child past a
    // threshold silently not a crossing.
    expect(first.previous_tier).toBe("jigyasu");

    const crossing = await awardPunya({
      studentId,
      featureKey: "manual_award",
      points: 1,
      note: "the point that crosses",
      idempotencyKey: `tierup-b-${studentId}`,
    });
    expect(crossing.tier).toBe("shravak");
    expect(crossing.previous_tier).toBe("jigyasu");
  });

  it("tier_reached_at is stamped on the crossing, not on every award", async () => {
    const t = await resolveTierThresholds();
    const studentId = await plantChildOfSeededParent(`${Date.now().toString(36).slice(-6)}s`);

    await awardPunya({
      studentId,
      featureKey: "manual_award",
      points: t.shravak,
      note: "crossing",
      idempotencyKey: `tierstamp-a-${studentId}`,
    });
    const [afterCross] = await db
      .select({ tier_reached_at: punya_balances.tier_reached_at })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    expect(afterCross?.tier_reached_at).not.toBeNull();
    const stamped = afterCross!.tier_reached_at!.getTime();

    // An award that does NOT change the tier must leave the stamp alone,
    // otherwise "when did they become Shravak" drifts forward forever.
    await awardPunya({
      studentId,
      featureKey: "manual_award",
      points: 5,
      note: "same tier",
      idempotencyKey: `tierstamp-b-${studentId}`,
    });
    const [afterSame] = await db
      .select({ tier_reached_at: punya_balances.tier_reached_at })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    expect(afterSame!.tier_reached_at!.getTime()).toBe(stamped);
  });

  it("notifies the parent on an upgrade, and never on a downgrade", async () => {
    const t = await resolveTierThresholds();
    const tag = `${Date.now().toString(36).slice(-6)}n`;
    const studentName = `TierUp ${tag}`;
    const studentId = await plantChildOfSeededParent(tag);

    await awardPunya({
      studentId,
      featureKey: "manual_award",
      points: t.shravak,
      note: "crossing up",
      idempotencyKey: `tiernotify-${studentId}`,
    });
    expect(await tierNotifications(studentName)).toBe(1);

    // A reversal can move a child back down. No child should be told by push
    // that they lost a tier — the same reasoning as Q5a.
    await reversePunya({
      studentId,
      featureKey: "manual_award",
      points: t.shravak,
      note: "undo",
      idempotencyKey: `tiernotify-${studentId}:reversal`,
    });
    const [after] = await db
      .select({ tier: punya_balances.tier })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    expect(after?.tier).toBe("jigyasu");
    expect(await tierNotifications(studentName)).toBe(1);
  });

  it("isTierUpgrade only counts genuine upward moves", () => {
    expect(isTierUpgrade("jigyasu", "shravak")).toBe(true);
    expect(isTierUpgrade("sadhak", "tirthankar")).toBe(true);
    expect(isTierUpgrade("shravak", "jigyasu")).toBe(false);
    expect(isTierUpgrade("sadhak", "sadhak")).toBe(false);
    // No prior row is not an upgrade: a brand-new balance is a starting point,
    // not an achievement to announce.
    expect(isTierUpgrade(null, "shravak")).toBe(false);
  });
});

describe("H4 — next_tier and points_to_next reach the client", () => {
  it("the parent's balance endpoint returns the distance to the next tier", async () => {
    const t = await resolveTierThresholds();
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const childId: string = children.body.data.items[0]!.id;

    const res = await request(app)
      .get(`/v1/me/students/${childId}/punya`)
      .set(auth(parent.token));
    expect(res.status).toBe(200);

    const { total_points, next_tier, points_to_next } = res.body.data;
    if (total_points >= t.tirthankar) {
      // Nothing above Tirthankar — a progress bar must not promise one.
      expect(next_tier).toBeNull();
      expect(points_to_next).toBeNull();
    } else {
      expect(typeof next_tier).toBe("string");
      expect(points_to_next).toBe(t[next_tier as keyof typeof t] - total_points);
      expect(points_to_next).toBeGreaterThan(0);
    }
  });
});
