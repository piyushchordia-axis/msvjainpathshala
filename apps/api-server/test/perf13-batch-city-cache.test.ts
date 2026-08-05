/**
 * PERF #13.1 — second resolveAttendanceAwardPointsForBatch must not re-query centres.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import {
  clearAttendancePointsCache,
  resolveAttendanceAwardPointsForBatch,
} from "../src/lib/attendance-points";

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
describe("PERF #13 batch→city punya cache", () => {
  it("second batch resolve issues fewer queries than the first", async () => {
    clearAttendancePointsCache();
    const batch = await pool.query<{ id: string }>(
      `select id from batches where deleted_at is null and status = 'active' limit 1`,
    );
    expect(batch.rows.length).toBe(1);
    const batchId = batch.rows[0]!.id;

    const { queries: q1 } = await withQueryCount(() =>
      resolveAttendanceAwardPointsForBatch(batchId),
    );
    const { queries: q2 } = await withQueryCount(() =>
      resolveAttendanceAwardPointsForBatch(batchId),
    );

    expect(q2).toBeLessThan(q1);
    expect(q2).toBe(0);
  });
});
