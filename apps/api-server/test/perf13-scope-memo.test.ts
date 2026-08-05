/**
 * PERF #13.2 — resolveAdminScope is memoized per User object (same request / sync batch).
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveAdminScope } from "../src/lib/scope";
import { withQueryCount } from "./helpers";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("PERF #13 admin scope memoization", () => {
  it("second resolveAdminScope on the same User issues zero queries", async () => {
    const [user] = await db.select().from(users).where(eq(users.role, "sanchalak")).limit(1);
    expect(user).toBeTruthy();

    const { count: q1 } = await withQueryCount(() => resolveAdminScope(user!));
    const { count: q2 } = await withQueryCount(() => resolveAdminScope(user!));

    expect(q1).toBeGreaterThan(0);
    expect(q2).toBe(0);
  });
});
