/**
 * End-to-end: materialised session → check-in → mark 20 (mixed) → offline
 * corrections → sync → check-out. Asserts AT17/AT18 ledger + AT4 excused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startHarness,
  stopHarness,
  type Harness,
  ulid,
  markedAtOnSessionDay,
} from "./harness";
import type { User } from "@workspace/db";
import pg from "pg";

describe("shikshak-full-day.e2e", () => {
  let h: Harness;
  let pool: pg.Pool;
  let actor: User;
  let excusedStudentId: string;
  let absenceId: string;
  let checkInSession: typeof import("../../src/services/session-lifecycle").checkInSession;
  let checkOutSession: typeof import("../../src/services/session-lifecycle").checkOutSession;
  let markAttendance: typeof import("../../src/services/attendance-mark").markAttendance;
  let processSyncBatch: typeof import("../../src/services/sync-batch").processSyncBatch;

  beforeAll(async () => {
    h = await startHarness();
    pool = h.pool;

    const client = await pool.connect();
    try {
      await client.query(
        `update centres set lat = 19.0760, lng = 72.8777, gps_radius_meters = 250 where id = $1`,
        [h.fixtures.centreId],
      );

      excusedStudentId = h.fixtures.studentIds[19]!;
      const parent = await client.query(
        `insert into users (phone, role, full_name, preferred_language, is_active)
         values ('+919900000020', 'parent', 'Test Parent', 'en', true) returning id`,
      );
      await client.query(`update students set parent_id = $1 where id = $2`, [
        parent.rows[0].id,
        excusedStudentId,
      ]);
      const abs = await client.query(
        `insert into absence_notifications (student_id, parent_user_id, start_date, end_date, reason)
         values ($1, $2, $3, $3, 'Family travel') returning id`,
        [excusedStudentId, parent.rows[0].id, h.fixtures.scheduledDate],
      );
      absenceId = abs.rows[0].id as string;

      await client.query(
        `update sessions set status = 'scheduled', scheduled_start_time = '10:00', scheduled_end_time = '11:00',
         check_in_at = null, check_out_at = null, submission_op_id = null
         where id = $1`,
        [h.fixtures.sessionId],
      );
      await client.query(`delete from attendance where session_id = $1`, [h.fixtures.sessionId]);
      await client.query(`delete from punya_transactions where source_entity_id = $1`, [
        h.fixtures.sessionId,
      ]);
    } finally {
      client.release();
    }

    actor = {
      id: h.fixtures.userId,
      role: "super_admin",
      phone: "+919900000001",
      full_name: "Test Guruji",
      preferred_language: "en",
      is_active: true,
      city_id: h.fixtures.cityId,
    } as User;

    const life = await import("../../src/services/session-lifecycle");
    checkInSession = life.checkInSession;
    checkOutSession = life.checkOutSession;
    markAttendance = (await import("../../src/services/attendance-mark")).markAttendance;
    processSyncBatch = (await import("../../src/services/sync-batch")).processSyncBatch;
  }, 180_000);

  afterAll(async () => {
    await stopHarness();
  });

  it("full day: check-in → mark 20 → offline corrections → sync → check-out", async () => {
    const { sessionId, studentIds, scheduledDate, attendancePoints } = h.fixtures;
    const markedAt = markedAtOnSessionDay(scheduledDate, 10);

    const checkedIn = await checkInSession({
      sessionId,
      actor,
      submissionOpId: ulid(),
      lat: 19.076,
      lng: 72.8777,
      accuracy_m: 12,
      batchId: h.fixtures.batchId,
    });
    expect(checkedIn.status).toBe("in_progress");
    expect(checkedIn.check_in_distance_m).not.toBeNull();

    const statuses = studentIds.map((id, i) => {
      if (id === excusedStudentId) return "excused" as const;
      if (i % 5 === 0) return "absent" as const;
      if (i % 5 === 1) return "late" as const;
      return "present" as const;
    });

    const first = await markAttendance({
      sessionId,
      userId: actor.id,
      actor,
      markedAt: new Date(markedAt),
      submissionOpId: ulid(),
      marks: studentIds.map((id, i) => ({
        student_id: id,
        status: statuses[i]!,
        client_op_id: ulid(),
      })),
    });
    expect(first.applied).toBe(20);

    const correctA = studentIds[2]!;
    const correctB = studentIds[3]!;
    expect(statuses[2]).toBe("present");
    expect(statuses[3]).toBe("present");

    const syncRes = await processSyncBatch(actor, {
      ops: [
        {
          submission_op_id: ulid(),
          op_type: "attendance",
          payload: {
            batch_id: h.fixtures.batchId,
            session_date: scheduledDate,
            marked_at: markedAt,
            marks: [
              { student_id: correctA, status: "absent", client_op_id: ulid() },
              { student_id: correctB, status: "absent", client_op_id: ulid() },
            ],
          },
          client_timestamp: new Date().toISOString(),
        },
      ],
    });
    expect(syncRes.results.every((r) => r.status === "success" || r.status === "duplicate")).toBe(
      true,
    );

    const checkedOut = await checkOutSession({
      sessionId,
      actor,
      lat: 19.0761,
      lng: 72.8778,
      accuracy_m: 15,
    });
    expect(checkedOut.status).toBe("completed");
    expect(checkedOut.check_out_distance_m).not.toBeNull();
    expect(checkedOut.duration_minutes).not.toBeNull();

    const client = await pool.connect();
    try {
      const marks = await client.query(
        `select student_id, status from attendance where session_id = $1`,
        [sessionId],
      );
      expect(marks.rows.length).toBe(20);
      const byId = new Map(marks.rows.map((r) => [r.student_id as string, r.status as string]));
      expect(byId.get(excusedStudentId)).toBe("excused");
      expect(byId.get(correctA)).toBe("absent");
      expect(byId.get(correctB)).toBe("absent");

      const abs = await client.query(`select resolved_at from absence_notifications where id = $1`, [
        absenceId,
      ]);
      expect(abs.rows[0].resolved_at).not.toBeNull();

      for (const sid of [correctA, correctB]) {
        const bal = await client.query(
          `select total_points from punya_balances where student_id = $1`,
          [sid],
        );
        const sum = await client.query(
          `select coalesce(sum(points),0)::int as s from punya_transactions where student_id = $1`,
          [sid],
        );
        expect(Number(bal.rows[0]?.total_points ?? 0)).toBe(Number(sum.rows[0].s));
        expect(Number(bal.rows[0]?.total_points ?? 0)).toBe(0);

        const txns = await client.query(
          `select idempotency_key from punya_transactions
           where student_id = $1 and source_entity_kind = 'attendance'
           order by created_at`,
          [sid],
        );
        expect(txns.rows.length).toBeGreaterThanOrEqual(2);
        const keys = txns.rows.map((t) => t.idempotency_key as string);
        expect(new Set(keys).size).toBe(keys.length);
      }

      const stillPresent = studentIds.find(
        (id, i) => statuses[i] === "present" && id !== correctA && id !== correctB,
      )!;
      const presentBal = await client.query(
        `select total_points from punya_balances where student_id = $1`,
        [stillPresent],
      );
      expect(Number(presentBal.rows[0].total_points)).toBe(attendancePoints);

      const notif = await client.query(
        `select count(*)::int as c from notifications
         where user_id = (select parent_id from students where id = $1)`,
        [excusedStudentId],
      );
      expect(Number(notif.rows[0].c)).toBeLessThan(20);

      const sess = await client.query(
        `select status, duration_minutes, check_in_distance_m, check_out_distance_m
         from sessions where id = $1`,
        [sessionId],
      );
      expect(sess.rows[0].status).toBe("completed");
      expect(sess.rows[0].duration_minutes).not.toBeNull();
      expect(sess.rows[0].check_in_distance_m).not.toBeNull();
      expect(sess.rows[0].check_out_distance_m).not.toBeNull();
    } finally {
      client.release();
    }
  });
});
