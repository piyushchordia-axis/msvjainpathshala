/**
 * Smoke tests for the shared query-count spy (PERF measurement harness).
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { pool, db } from "@workspace/db";
import { withQueryCount } from "./helpers";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("withQueryCount", () => {
  it("counts pool.query statements", async () => {
    const { count } = await withQueryCount(async () => {
      await pool.query(`select 1`);
      await pool.query(`select 2`);
    });
    expect(count).toBe(2);
  });

  it("counts drizzle statements on the request pool", async () => {
    const { count } = await withQueryCount(async () => {
      await db.execute(sql`select 1 as n`);
    });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("counts Client.query inside a transaction", async () => {
    const { count } = await withQueryCount(async () => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select 1 as a`);
        await tx.execute(sql`select 2 as b`);
      });
    });
    // At least the two statements (BEGIN/COMMIT may also register).
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("resets between calls (no cross-test leakage)", async () => {
    const first = await withQueryCount(async () => {
      await pool.query(`select 1`);
    });
    const second = await withQueryCount(async () => {
      await pool.query(`select 1`);
      await pool.query(`select 1`);
    });
    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
  });

  it("does not count queries outside the wrapped block", async () => {
    await pool.query(`select 1`);
    const { count } = await withQueryCount(async () => {
      await pool.query(`select 1`);
    });
    await pool.query(`select 1`);
    expect(count).toBe(1);
  });
});
