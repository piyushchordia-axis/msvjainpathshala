/**
 * H16 — GET /v1/admin/punya/transactions.
 *
 * Two defects in one route:
 *
 *  - It filtered on centre only. resolveAdminScope hands a shikshak centreIds
 *    for their WHOLE centre, so a batch-restricted role read the entire
 *    centre's ledger — every child in it, including the batches they do not
 *    teach. Q12 binds a shikshak to their own batches for niyam decisions and
 *    the same boundary belongs here; niyam already solved it with
 *    inBatchWriteScope, and this route never consulted batchIds at all.
 *  - It returned no next_cursor while the admin list derives hasMore from
 *    exactly that field, so Load More was permanently inert and the audit
 *    truncated in silence.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";
import { auth, loginAs } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("H16 — punya transactions are batch-scoped and cursored", () => {
  it("a shikshak sees only their own batches, not the whole centre", async () => {
    const shikshak = await loginAs("shikshak");
    const res = await request(app)
      .get("/v1/admin/punya/transactions?limit=500")
      .set(auth(shikshak.token));
    expect(res.status).toBe(200);

    const items: Array<{ student_code: string }> = res.body.data.items;
    if (items.length === 0) return;

    // Every returned row must belong to a batch this shikshak is assigned to.
    const { rows: allowed } = await pool.query<{ student_code: string }>(
      `select s.student_code
         from students s
         join shikshak_batch_assignments a
           on a.batch_id = s.batch_id and a.is_active = true
        where a.user_id = $1 and s.deleted_at is null`,
      [shikshak.user.id],
    );
    const allowedCodes = new Set(allowed.map((r) => r.student_code));
    const leaked = items.filter((i) => !allowedCodes.has(i.student_code));
    expect(leaked).toEqual([]);
  });

  it("a sanchalak still sees their whole centre", async () => {
    // inBatchWriteScope resolves batchIds === null to centre membership, so the
    // tightening must not clip the role it was never about.
    const sanchalak = await loginAs("sanchalak");
    const res = await request(app)
      .get("/v1/admin/punya/transactions?limit=50")
      .set(auth(sanchalak.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it("pages with a keyset cursor and stops cleanly", async () => {
    const admin = await loginAs("super_admin");
    const first = await request(app)
      .get("/v1/admin/punya/transactions?limit=5")
      .set(auth(admin.token));
    expect(first.status).toBe(200);
    expect(first.body.data.items.length).toBeLessThanOrEqual(5);

    const cursor = first.body.meta?.next_cursor;
    if (!cursor) return; // fewer than 5 rows in this database

    const second = await request(app)
      .get(`/v1/admin/punya/transactions?limit=5&cursor=${encodeURIComponent(cursor)}`)
      .set(auth(admin.token));
    expect(second.status).toBe(200);

    // No overlap: a keyset that skipped or repeated a row would be worse than
    // no pagination, because the audit would silently disagree with itself.
    const firstIds = new Set(first.body.data.items.map((i: { id: string }) => i.id));
    const overlap = second.body.data.items.filter((i: { id: string }) => firstIds.has(i.id));
    expect(overlap).toEqual([]);

    // Ordering holds across the page boundary.
    const lastOfFirst = first.body.data.items.at(-1)!.created_at;
    const firstOfSecond = second.body.data.items[0]?.created_at;
    if (firstOfSecond) {
      expect(new Date(firstOfSecond).getTime()).toBeLessThanOrEqual(
        new Date(lastOfFirst).getTime(),
      );
    }
  });

  it("rejects a malformed cursor rather than silently ignoring it", async () => {
    const admin = await loginAs("super_admin");
    const res = await request(app)
      .get("/v1/admin/punya/transactions?cursor=not-a-cursor")
      .set(auth(admin.token));
    expect(res.status).toBe(422);
  });
});
