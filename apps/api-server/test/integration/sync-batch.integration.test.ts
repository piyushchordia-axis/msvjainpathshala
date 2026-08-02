/**
 * Offline sync/batch integration tests (canonical model).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startHarness,
  stopHarness,
  markedAtOnSessionDay,
  type Harness,
} from "./harness";
import { ulid } from "../../src/lib/ulid";

describe("sync/batch offline transport", () => {
  let h: Harness;
  let processSyncBatch: typeof import("../../src/services/sync-batch").processSyncBatch;
  let db: typeof import("@workspace/db").db;
  let sql: typeof import("drizzle-orm").sql;

  beforeAll(async () => {
    h = await startHarness();
    const svc = await import("../../src/services/sync-batch");
    processSyncBatch = svc.processSyncBatch;
    const dbMod = await import("@workspace/db");
    db = dbMod.db;
    sql = (await import("drizzle-orm")).sql;
  }, 180_000);

  afterAll(async () => {
    await stopHarness();
  });

  function actor() {
    // super_admin avoids staffing-table scope (assignments may be absent in harness).
    return {
      id: h.fixtures.userId,
      role: "super_admin",
      phone: "+919900000001",
      full_name: "Test Guruji",
      preferred_language: "en",
      is_active: true,
      state_id: null,
      city_id: h.fixtures.cityId,
      deleted_at: null,
    } as never;
  }

  it("20-student roster offline → exactly 20 rows + 20 punya awards", async () => {
    const { batchId, sessionId, scheduledDate, studentIds } = h.fixtures;
    await h.pool.query(`delete from attendance where session_id = $1`, [sessionId]);
    await h.pool.query(`delete from punya_transactions where source_entity_id = $1`, [sessionId]);
    await h.pool.query(
      `update sessions set status = 'scheduled', check_in_at = null, submission_op_id = null where id = $1`,
      [sessionId],
    );

    const marks = studentIds.map((student_id) => ({
      student_id,
      status: "present" as const,
      client_op_id: ulid(),
    }));

    const { results } = await processSyncBatch(actor(), {
      ops: [
        {
          submission_op_id: ulid(),
          op_type: "checkin",
          payload: {
            batch_id: batchId,
            session_date: scheduledDate,
            lat: 19.0861,
            lng: 72.9081,
            accuracy_m: 10,
          },
          client_timestamp: new Date().toISOString(),
        },
        {
          submission_op_id: ulid(),
          op_type: "attendance",
          payload: {
            batch_id: batchId,
            session_date: scheduledDate,
            marked_at: markedAtOnSessionDay(scheduledDate),
            marks,
          },
          client_timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(results[0]!.status).toBe("success");
    expect(results[1]!.status).toBe("success");

    const att = await h.pool.query(
      `select count(*)::int as n from attendance where session_id = $1`,
      [sessionId],
    );
    expect(att.rows[0]!.n).toBe(20);

    const punya = await h.pool.query(
      `select count(*)::int as n from punya_transactions
       where feature_key = 'attendance' and source_entity_id = $1 and points > 0`,
      [sessionId],
    );
    expect(punya.rows[0]!.n).toBe(20);
  });

  it("full offline session: checkin → mark → checkout apply in order", async () => {
    const date = "2026-08-10";
    const { batchId, userId, studentIds } = h.fixtures;
    await h.pool.query(
      `insert into sessions (batch_id, scheduled_date, scheduled_start_time, scheduled_end_time, status, shikshak_user_id)
       values ($1, $2, '09:00', '10:30', 'scheduled', $3)`,
      [batchId, date, userId],
    );

    const { results } = await processSyncBatch(actor(), {
      ops: [
        {
          submission_op_id: ulid(),
          op_type: "checkin",
          payload: {
            batch_id: batchId,
            session_date: date,
            lat: 19.0861,
            lng: 72.9081,
            accuracy_m: 12,
          },
          client_timestamp: new Date().toISOString(),
        },
        {
          submission_op_id: ulid(),
          op_type: "attendance",
          payload: {
            batch_id: batchId,
            session_date: date,
            marked_at: markedAtOnSessionDay(date),
            marks: [
              { student_id: studentIds[0]!, status: "present", client_op_id: ulid() },
            ],
          },
          client_timestamp: new Date().toISOString(),
        },
        {
          submission_op_id: ulid(),
          op_type: "checkout",
          payload: {
            batch_id: batchId,
            session_date: date,
            lat: 19.0862,
            lng: 72.9082,
            accuracy_m: 10,
          },
          client_timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(results.map((r) => r.status)).toEqual(["success", "success", "success"]);
    const sess = await h.pool.query(
      `select status, unscheduled from sessions where batch_id = $1 and scheduled_date = $2`,
      [batchId, date],
    );
    expect(sess.rows[0]!.status).toBe("completed");
  });

  it("no materialised session → checkin soft-creates unscheduled → attendance resolves", async () => {
    const date = "2026-08-11";
    const { batchId, studentIds } = h.fixtures;
    await h.pool.query(`delete from sessions where batch_id = $1 and scheduled_date = $2`, [
      batchId,
      date,
    ]);

    const { results } = await processSyncBatch(actor(), {
      ops: [
        {
          submission_op_id: ulid(),
          op_type: "checkin",
          payload: {
            batch_id: batchId,
            session_date: date,
            lat: 19.0861,
            lng: 72.9081,
            accuracy_m: 10,
          },
          client_timestamp: new Date().toISOString(),
        },
        {
          submission_op_id: ulid(),
          op_type: "attendance",
          payload: {
            batch_id: batchId,
            session_date: date,
            marked_at: markedAtOnSessionDay(date),
            marks: [
              { student_id: studentIds[0]!, status: "present", client_op_id: ulid() },
            ],
          },
          client_timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(results[0]!.status).toBe("success");
    expect(results[1]!.status).toBe("success");
    const sess = await h.pool.query(
      `select unscheduled from sessions where batch_id = $1 and scheduled_date = $2`,
      [batchId, date],
    );
    expect(sess.rows[0]!.unscheduled).toBe(true);
  });

  it("duplicate submission_op_id replay → no duplicate rows / no balance change", async () => {
    const date = "2026-08-12";
    const { batchId, studentIds } = h.fixtures;
    await h.pool.query(
      `insert into sessions (batch_id, scheduled_date, scheduled_start_time, scheduled_end_time, status)
       values ($1, $2, '09:00', '10:30', 'in_progress')`,
      [batchId, date],
    );
    const opId = ulid();
    const body = {
      ops: [
        {
          submission_op_id: opId,
          op_type: "attendance" as const,
          payload: {
            batch_id: batchId,
            session_date: date,
            marked_at: markedAtOnSessionDay(date),
            marks: [
              { student_id: studentIds[1]!, status: "present", client_op_id: ulid() },
            ],
          },
          client_timestamp: new Date().toISOString(),
        },
      ],
    };

    const first = await processSyncBatch(actor(), body);
    expect(first.results[0]!.status).toBe("success");
    const bal1 = await h.pool.query(
      `select coalesce(total_points,0)::int as n from punya_balances where student_id = $1`,
      [studentIds[1]!],
    );

    const second = await processSyncBatch(actor(), body);
    expect(second.results[0]!.status).toBe("success");

    const att = await h.pool.query(
      `select count(*)::int as n from attendance a
       join sessions s on s.id = a.session_id
       where s.batch_id = $1 and s.scheduled_date = $2 and a.student_id = $3`,
      [batchId, date, studentIds[1]!],
    );
    expect(att.rows[0]!.n).toBe(1);

    const bal2 = await h.pool.query(
      `select coalesce(total_points,0)::int as n from punya_balances where student_id = $1`,
      [studentIds[1]!],
    );
    expect(bal2.rows[0]!.n).toBe(bal1.rows[0]!.n);

    const syncRows = await h.pool.query(
      `select count(*)::int as n from sync_operations where submission_op_id = $1`,
      [opId],
    );
    expect(syncRows.rows[0]!.n).toBe(1);
  });

  it("server 409 mid-batch → conflict op marked, remaining ops still apply", async () => {
    const date = "2026-08-13";
    const date2 = "2026-08-14";
    const { batchId, studentIds } = h.fixtures;
    await h.pool.query(
      `insert into sessions (batch_id, scheduled_date, scheduled_start_time, scheduled_end_time, status)
       values ($1, $2, '09:00', '10:30', 'cancelled')`,
      [batchId, date],
    );
    await h.pool.query(
      `insert into sessions (batch_id, scheduled_date, scheduled_start_time, scheduled_end_time, status)
       values ($1, $2, '09:00', '10:30', 'in_progress')`,
      [batchId, date2],
    );

    const { results } = await processSyncBatch(actor(), {
      ops: [
        {
          submission_op_id: ulid(),
          op_type: "attendance",
          payload: {
            batch_id: batchId,
            session_date: date,
            marked_at: markedAtOnSessionDay(date),
            marks: [
              { student_id: studentIds[2]!, status: "present", client_op_id: ulid() },
            ],
          },
          client_timestamp: new Date().toISOString(),
        },
        {
          submission_op_id: ulid(),
          op_type: "attendance",
          payload: {
            batch_id: batchId,
            session_date: date2,
            marked_at: markedAtOnSessionDay(date2),
            marks: [
              { student_id: studentIds[2]!, status: "present", client_op_id: ulid() },
            ],
          },
          client_timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(results[0]!.status).toBe("conflict");
    expect(results[1]!.status).toBe("success");
  });
});
