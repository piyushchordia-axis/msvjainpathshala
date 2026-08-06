/**
 * PERF #8 — retention for sync_operations and read notifications.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, db, sync_operations, notifications, users } from "@workspace/db";
import { pruneSyncOperations, pruneReadNotifications } from "../src/lib/retention";
import { ulid } from "../src/lib/ulid";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("retention prune (PERF #8)", () => {
  it("the retention job prunes sync_operations older than the window and nothing newer", async () => {
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    expect(user).toBeTruthy();

    const oldId = ulid();
    const newId = ulid();
    const planted: string[] = [];

    const [oldRow] = await db
      .insert(sync_operations)
      .values({
        user_id: user!.id,
        submission_op_id: oldId,
        op_kind: "attendance",
        status: "success",
        request_payload: { perf8: true },
        applied_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: sync_operations.id });
    planted.push(oldRow!.id);

    const [newRow] = await db
      .insert(sync_operations)
      .values({
        user_id: user!.id,
        submission_op_id: newId,
        op_kind: "attendance",
        status: "success",
        request_payload: { perf8: true },
        applied_at: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: sync_operations.id });
    planted.push(newRow!.id);

    try {
      const deleted = await pruneSyncOperations(30);
      expect(deleted).toBeGreaterThanOrEqual(1);

      const left = await pool.query<{ id: string; submission_op_id: string }>(
        `select id, submission_op_id from sync_operations where id = any($1::uuid[])`,
        [planted],
      );
      const ids = left.rows.map((r) => r.submission_op_id);
      expect(ids).toContain(newId);
      expect(ids).not.toContain(oldId);
    } finally {
      await pool.query(`delete from sync_operations where id = any($1::uuid[])`, [planted]);
    }
  });

  it("the retention job never deletes an unapplied or failed operation", async () => {
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    expect(user).toBeTruthy();

    const planted: string[] = [];
    for (const status of ["failed", "processing", "conflict"] as const) {
      const [row] = await db
        .insert(sync_operations)
        .values({
          user_id: user!.id,
          submission_op_id: ulid(),
          op_kind: "attendance",
          status,
          request_payload: { perf8: true },
          applied_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        })
        .returning({ id: sync_operations.id });
      planted.push(row!.id);
    }

    try {
      await pruneSyncOperations(30);
      const left = await pool.query(
        `select count(*)::int as n from sync_operations where id = any($1::uuid[])`,
        [planted],
      );
      expect(left.rows[0]!.n).toBe(3);
    } finally {
      await pool.query(`delete from sync_operations where id = any($1::uuid[])`, [planted]);
    }
  });

  it("notification retention keeps unread rows regardless of age", async () => {
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    expect(user).toBeTruthy();

    const old = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const planted: string[] = [];

    const [unread] = await db
      .insert(notifications)
      .values({
        user_id: user!.id,
        kind: "general",
        title_en: "perf8 unread",
        title_hi: "पर्फ8 अनरीड",
        body_en: "keep me",
        body_hi: "रखें",
        read_at: null,
        created_at: old,
        updated_at: old,
      })
      .returning({ id: notifications.id });
    planted.push(unread!.id);

    const [read] = await db
      .insert(notifications)
      .values({
        user_id: user!.id,
        kind: "general",
        title_en: "perf8 read",
        title_hi: "पर्फ8 रीड",
        body_en: "prune me",
        body_hi: "हटाएँ",
        read_at: old,
        created_at: old,
        updated_at: old,
      })
      .returning({ id: notifications.id });
    planted.push(read!.id);

    try {
      const deleted = await pruneReadNotifications(90);
      expect(deleted).toBeGreaterThanOrEqual(1);

      const left = await pool.query<{ id: string; title_en: string }>(
        `select id, title_en from notifications where id = any($1::uuid[])`,
        [planted],
      );
      expect(left.rows.map((r) => r.id)).toContain(unread!.id);
      expect(left.rows.map((r) => r.id)).not.toContain(read!.id);
    } finally {
      await pool.query(`delete from notifications where id = any($1::uuid[])`, [planted]);
    }
  });
});
