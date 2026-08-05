/**
 * PERF #13.1 — second resolveAttendanceAwardPointsForBatch must not re-query centres.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import {
  clearAttendancePointsCache,
  resolveAttendanceAwardPointsForBatch,
} from "../src/lib/attendance-points";
import { withQueryCount } from "./helpers";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("PERF #13 batch→city punya cache", () => {
  it("second batch resolve issues fewer queries than the first", async () => {
    clearAttendancePointsCache();
    const batch = await pool.query<{ id: string }>(
      `select id from batches where deleted_at is null and status = 'active' limit 1`,
    );
    expect(batch.rows.length).toBe(1);
    const batchId = batch.rows[0]!.id;

    const { count: q1 } = await withQueryCount(() =>
      resolveAttendanceAwardPointsForBatch(batchId),
    );
    const { count: q2 } = await withQueryCount(() =>
      resolveAttendanceAwardPointsForBatch(batchId),
    );

    expect(q2).toBeLessThan(q1);
    expect(q2).toBe(0);
  });
});
