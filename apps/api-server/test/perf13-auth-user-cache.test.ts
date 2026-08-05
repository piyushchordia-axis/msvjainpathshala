/**
 * PERF #13.3 — auth user lookup is projected + memoized across consecutive loads.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { clearAuthUserCache, loadAuthUser } from "../src/lib/auth-user-cache";
import { withQueryCount } from "./helpers";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("PERF #13 auth user cache", () => {
  it("second loadAuthUser hits cache (zero DB queries)", async () => {
    clearAuthUserCache();
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.role, "super_admin")).limit(1);
    expect(u).toBeTruthy();

    const { count: q1 } = await withQueryCount(() => loadAuthUser(u!.id));
    const { count: q2 } = await withQueryCount(() => loadAuthUser(u!.id));

    expect(q1).toBeGreaterThan(0);
    expect(q2).toBe(0);
  });
});
