/**
 * PERF #13.2 — resolveAdminScope is memoized per User object (same request / sync batch).
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveAdminScope } from "../src/lib/scope";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

async function withQueryCount<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  let queries = 0;
  const origConnect = pool.connect.bind(pool);
  const origQuery = pool.query.bind(pool);
  const wrapClient = (client: { query: typeof pool.query; __p?: typeof pool.query }) => {
    if (!client.__p) client.__p = client.query.bind(client);
    const oq = client.__p;
    client.query = ((...args: unknown[]) => {
      queries += 1;
      return (oq as (...a: unknown[]) => unknown)(...args);
    }) as typeof client.query;
    return client;
  };
  pool.connect = ((arg?: unknown) => {
    if (typeof arg === "function") {
      return origConnect((err: Error | undefined, client: unknown, release: unknown) => {
        if (client) wrapClient(client as { query: typeof pool.query });
        return (arg as (e: unknown, c: unknown, r: unknown) => void)(err, client, release);
      });
    }
    return (origConnect as () => Promise<{ query: typeof pool.query }>)().then(wrapClient);
  }) as typeof pool.connect;
  pool.query = ((...args: unknown[]) => {
    queries += 1;
    return (origQuery as (...a: unknown[]) => unknown)(...args);
  }) as typeof pool.query;
  try {
    return { result: await fn(), queries };
  } finally {
    pool.connect = origConnect;
    pool.query = origQuery;
  }
}

describe("PERF #13 admin scope memoization", () => {
  it("second resolveAdminScope on the same User issues zero queries", async () => {
    const [user] = await db.select().from(users).where(eq(users.role, "sanchalak")).limit(1);
    expect(user).toBeTruthy();

    const { queries: q1 } = await withQueryCount(() => resolveAdminScope(user!));
    const { queries: q2 } = await withQueryCount(() => resolveAdminScope(user!));

    expect(q1).toBeGreaterThan(0);
    expect(q2).toBe(0);
  });
});
