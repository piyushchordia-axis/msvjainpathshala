import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startHarness,
  stopHarness,
  markedAtOnSessionDay,
  newSubmission,
  type Harness,
} from "./harness";
import { ulid } from "../../src/lib/ulid";

describe("attendance mark transaction (AT3/AT17–AT21/AT24/AT26)", () => {
  let h: Harness;
  let markAttendance: typeof import("../../src/services/attendance-mark").markAttendance;
  let patchAttendanceMark: typeof import("../../src/services/attendance-mark").patchAttendanceMark;
  let AttendanceMarkError: typeof import("../../src/services/attendance-mark").AttendanceMarkError;
  let sumAttendanceLedger: typeof import("../../src/services/attendance-mark").sumAttendanceLedger;
  let db: typeof import("@workspace/db").db;
  let attendance: typeof import("@workspace/db").attendance;
  let sessions: typeof import("@workspace/db").sessions;
  let students: typeof import("@workspace/db").students;
  let punya_transactions: typeof import("@workspace/db").punya_transactions;
  let punya_balances: typeof import("@workspace/db").punya_balances;
  let eq: typeof import("drizzle-orm").eq;
  let and: typeof import("drizzle-orm").and;
  let sql: typeof import("drizzle-orm").sql;

  beforeAll(async () => {
    h = await startHarness();
    // Import ONLY after DATABASE_URL points at the container.
    const svc = await import("../../src/services/attendance-mark");
    markAttendance = svc.markAttendance;
    patchAttendanceMark = svc.patchAttendanceMark;
    AttendanceMarkError = svc.AttendanceMarkError;
    sumAttendanceLedger = svc.sumAttendanceLedger;
    const dbMod = await import("@workspace/db");
    db = dbMod.db;
    attendance = dbMod.attendance;
    sessions = dbMod.sessions;
    students = dbMod.students;
    punya_transactions = dbMod.punya_transactions;
    punya_balances = dbMod.punya_balances;
    const orm = await import("drizzle-orm");
    eq = orm.eq;
    and = orm.and;
    sql = orm.sql;
  }, 180_000);

  afterAll(async () => {
    await stopHarness();
  });

  async function resetSessionState(): Promise<void> {
    const { sessionId, studentIds } = h.fixtures;
    await db.delete(punya_transactions).where(sql`true`);
    await db.execute(sql`update punya_balances set total_points = 0, tier = 'jigyasu'`);
    await db.delete(attendance).where(eq(attendance.session_id, sessionId));
    await db
      .update(sessions)
      .set({ status: "scheduled", cancelled_at: null, cancellation_reason: null, cancellation_by: null })
      .where(eq(sessions.id, sessionId));
    for (const id of studentIds) {
      await db
        .update(students)
        .set({ status: "active", batch_id: h.fixtures.batchId })
        .where(eq(students.id, id));
    }
  }

  async function balanceOf(studentId: string): Promise<number> {
    const [row] = await db
      .select({ total_points: punya_balances.total_points })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    return row?.total_points ?? 0;
  }

  async function txnCount(studentId?: string): Promise<number> {
    const rows = await db
      .select({ id: punya_transactions.id })
      .from(punya_transactions)
      .where(
        studentId
          ? and(
              eq(punya_transactions.student_id, studentId),
              eq(punya_transactions.source_entity_kind, "attendance"),
            )
          : eq(punya_transactions.source_entity_kind, "attendance"),
      );
    return rows.length;
  }

  async function assertInvariant(studentId: string): Promise<void> {
    const ledger = await sumAttendanceLedger(studentId);
    const rows = await db
      .select({ status: attendance.status })
      .from(attendance)
      .where(eq(attendance.student_id, studentId));
    const expected = rows
      .filter((r) => r.status === "present" || r.status === "late")
      .reduce((s) => s + h.fixtures.attendancePoints, 0);
    expect(ledger).toBe(expected);
  }

  it("0. duplicate student_id in one submission → 400 ERR_VALIDATION_FAILED", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate } = h.fixtures;
    const sid = studentIds[0]!;
    const p = newSubmission([
      { student_id: sid, status: "present" },
      { student_id: sid, status: "absent" },
    ]);
    await expect(
      markAttendance({
        sessionId,
        userId,
        markedAt: new Date(markedAtOnSessionDay(scheduledDate)),
        submissionOpId: p.submission_op_id,
        marks: p.marks as never,
      }),
    ).rejects.toMatchObject({
      code: "ERR_VALIDATION_FAILED",
      httpStatus: 400,
      message: expect.stringContaining(sid),
    });
    const rows = await db.select().from(attendance).where(eq(attendance.session_id, sessionId));
    expect(rows).toHaveLength(0);
  });

  it("1. 20 students present → 20 rows, 20 txns, correct balances", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate, attendancePoints } = h.fixtures;
    const payload = newSubmission(studentIds.map((id) => ({ student_id: id, status: "present" })));
    const res = await markAttendance({
      sessionId,
      userId,
      markedAt: new Date(markedAtOnSessionDay(scheduledDate)),
      submissionOpId: payload.submission_op_id,
      marks: payload.marks as never,
    });
    expect(res.applied).toBe(20);
    expect(res.rejected).toBe(0);
    const rows = await db.select().from(attendance).where(eq(attendance.session_id, sessionId));
    expect(rows).toHaveLength(20);
    expect(await txnCount()).toBe(20);
    for (const id of studentIds) {
      expect(await balanceOf(id)).toBe(attendancePoints);
      await assertInvariant(id);
    }
  });

  it("2. Replay identical payload, same submission_op_id → unchanged", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate, attendancePoints } = h.fixtures;
    const payload = newSubmission(studentIds.map((id) => ({ student_id: id, status: "present" })));
    const first = await markAttendance({
      sessionId,
      userId,
      markedAt: new Date(markedAtOnSessionDay(scheduledDate)),
      submissionOpId: payload.submission_op_id,
      marks: payload.marks as never,
    });
    const second = await markAttendance({
      sessionId,
      userId,
      markedAt: new Date(markedAtOnSessionDay(scheduledDate)),
      submissionOpId: payload.submission_op_id,
      marks: payload.marks as never,
    });
    expect(second).toEqual(first);
    expect(await txnCount()).toBe(20);
    expect(await balanceOf(studentIds[0]!)).toBe(attendancePoints);
  });

  it("3. Replay identical marks, NEW submission_op_id → balances unchanged", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate, attendancePoints } = h.fixtures;
    const first = newSubmission(studentIds.map((id) => ({ student_id: id, status: "present" })));
    await markAttendance({
      sessionId,
      userId,
      markedAt: new Date(markedAtOnSessionDay(scheduledDate)),
      submissionOpId: first.submission_op_id,
      marks: first.marks as never,
    });
    const second = newSubmission(studentIds.map((id) => ({ student_id: id, status: "present" })));
    const res = await markAttendance({
      sessionId,
      userId,
      markedAt: new Date(markedAtOnSessionDay(scheduledDate, 11)),
      submissionOpId: second.submission_op_id,
      marks: second.marks as never,
    });
    expect(res.duplicate).toBe(20);
    expect(res.applied).toBe(0);
    expect(await txnCount()).toBe(20);
    for (const id of studentIds) {
      expect(await balanceOf(id)).toBe(attendancePoints);
      await assertInvariant(id);
    }
  });

  it("4. present → absent → present: 3 txns, final balance == one award", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate, attendancePoints } = h.fixtures;
    const sid = studentIds[0]!;
    const mark = async (status: "present" | "absent", hour: number) => {
      const p = newSubmission([{ student_id: sid, status }]);
      return markAttendance({
        sessionId,
        userId,
        markedAt: new Date(markedAtOnSessionDay(scheduledDate, hour)),
        submissionOpId: p.submission_op_id,
        marks: p.marks as never,
      });
    };
    await mark("present", 9);
    await mark("absent", 10);
    await mark("present", 11);
    expect(await txnCount(sid)).toBe(3);
    expect(await balanceOf(sid)).toBe(attendancePoints);
    await assertInvariant(sid);
    const keys = await db
      .select({ k: punya_transactions.idempotency_key })
      .from(punya_transactions)
      .where(eq(punya_transactions.student_id, sid));
    expect(new Set(keys.map((r) => r.k)).size).toBe(3);
  });

  it("5. present → late: reverse+award pair (3 txns total), balance == one award", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate, attendancePoints } = h.fixtures;
    const sid = studentIds[1]!;
    for (const [status, hour] of [
      ["present", 9],
      ["late", 10],
    ] as const) {
      const p = newSubmission([{ student_id: sid, status }]);
      await markAttendance({
        sessionId,
        userId,
        markedAt: new Date(markedAtOnSessionDay(scheduledDate, hour)),
        submissionOpId: p.submission_op_id,
        marks: p.marks as never,
      });
    }
    // award(r1) + reverse(r2) + award(r2) — never a bare second award (AT18)
    expect(await txnCount(sid)).toBe(3);
    expect(await balanceOf(sid)).toBe(attendancePoints);
    await assertInvariant(sid);
  });

  it("6. absent → excused: no new txns, balance unchanged", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate } = h.fixtures;
    const sid = studentIds[2]!;
    for (const [status, hour] of [
      ["absent", 9],
      ["excused", 10],
    ] as const) {
      const p = newSubmission([{ student_id: sid, status }]);
      await markAttendance({
        sessionId,
        userId,
        markedAt: new Date(markedAtOnSessionDay(scheduledDate, hour)),
        submissionOpId: p.submission_op_id,
        marks: p.marks as never,
      });
    }
    expect(await txnCount(sid)).toBe(0);
    expect(await balanceOf(sid)).toBe(0);
    await assertInvariant(sid);
  });

  it("7. Mark on cancelled session → 409 ERR_SESSION_CANCELLED", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate } = h.fixtures;
    await db
      .update(sessions)
      .set({ status: "cancelled", cancelled_at: new Date() })
      .where(eq(sessions.id, sessionId));
    const p = newSubmission([{ student_id: studentIds[0]!, status: "present" }]);
    await expect(
      markAttendance({
        sessionId,
        userId,
        markedAt: new Date(markedAtOnSessionDay(scheduledDate)),
        submissionOpId: p.submission_op_id,
        marks: p.marks as never,
      }),
    ).rejects.toMatchObject({ code: "ERR_SESSION_CANCELLED", httpStatus: 409 });
    expect(AttendanceMarkError).toBeTruthy();
  });

  it("8. Edit window: late arrival with in-window marked_at succeeds; outside → 409 (both routes)", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate } = h.fixtures;
    const sid = studentIds[3]!;

    const okPayload = newSubmission([{ student_id: sid, status: "present" }]);
    // Client marked_at on session day; "arriving" now is irrelevant.
    const okRes = await markAttendance({
      sessionId,
      userId,
      markedAt: new Date(markedAtOnSessionDay(scheduledDate, 16)),
      submissionOpId: okPayload.submission_op_id,
      marks: okPayload.marks as never,
    });
    expect(okRes.applied).toBe(1);

    await expect(
      patchAttendanceMark({
        sessionId,
        studentId: sid,
        userId,
        markedAt: new Date("2026-03-20T12:00:00.000+05:30"), // outside window
        status: "late",
        client_op_id: ulid(),
      }),
    ).rejects.toMatchObject({ code: "ERR_ATTENDANCE_EDIT_WINDOW_EXPIRED", httpStatus: 409 });

    await expect(
      markAttendance({
        sessionId,
        userId,
        markedAt: new Date("2026-03-01T10:00:00.000+05:30"),
        submissionOpId: ulid(),
        marks: [{ student_id: sid, status: "absent", client_op_id: ulid() }],
      }),
    ).rejects.toMatchObject({ code: "ERR_ATTENDANCE_EDIT_WINDOW_EXPIRED", httpStatus: 409 });
  });

  it("9. Roster of 20 with 1 deactivated → 19 succeed, 1 rejected", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate } = h.fixtures;
    const deactivated = studentIds[19]!;
    await db.update(students).set({ status: "inactive" }).where(eq(students.id, deactivated));

    const payload = newSubmission(studentIds.map((id) => ({ student_id: id, status: "present" })));
    const res = await markAttendance({
      sessionId,
      userId,
      markedAt: new Date(markedAtOnSessionDay(scheduledDate)),
      submissionOpId: payload.submission_op_id,
      marks: payload.marks as never,
    });
    expect(res.applied).toBe(19);
    expect(res.rejected).toBe(1);
    const rejected = res.items.find((i) => i.result === "rejected");
    expect(rejected).toMatchObject({
      student_id: deactivated,
      code: "ERR_STUDENT_NOT_ENROLLED",
    });
  });

  it("10. Concurrent marks, same (session, student) → one wins, no duplicate Punya", async () => {
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate, attendancePoints } = h.fixtures;
    const sid = studentIds[4]!;
    const a = newSubmission([{ student_id: sid, status: "present" }]);
    const b = newSubmission([{ student_id: sid, status: "late" }]);
    const markedAt = new Date(markedAtOnSessionDay(scheduledDate, 12));
    await Promise.all([
      markAttendance({
        sessionId,
        userId,
        markedAt,
        submissionOpId: a.submission_op_id,
        marks: a.marks as never,
      }),
      markAttendance({
        sessionId,
        userId,
        markedAt,
        submissionOpId: b.submission_op_id,
        marks: b.marks as never,
      }),
    ]);
    expect(await balanceOf(sid)).toBe(attendancePoints);
    await assertInvariant(sid);
    // Net award-worthy rows for this student on this session: exactly one attendance row
    const rows = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.session_id, sessionId), eq(attendance.student_id, sid)));
    expect(rows).toHaveLength(1);
  });

  it("11. INVARIANT: ledger sum == resolved award value across scenarios", async () => {
    // Covered in asserts above; run a mixed path and check all students touched.
    await resetSessionState();
    const { sessionId, studentIds, userId, scheduledDate } = h.fixtures;
    const sid = studentIds[5]!;
    for (const [status, hour] of [
      ["present", 9],
      ["late", 10],
      ["absent", 11],
      ["present", 12],
    ] as const) {
      const p = newSubmission([{ student_id: sid, status }]);
      await markAttendance({
        sessionId,
        userId,
        markedAt: new Date(markedAtOnSessionDay(scheduledDate, hour)),
        submissionOpId: p.submission_op_id,
        marks: p.marks as never,
      });
    }
    await assertInvariant(sid);
  });

  async function sumAllLedger(studentId: string): Promise<number> {
    const [row] = await db
      .select({
        sum: sql<number>`coalesce(sum(${punya_transactions.points}), 0)::int`,
      })
      .from(punya_transactions)
      .where(eq(punya_transactions.student_id, studentId));
    return Number(row?.sum ?? 0);
  }

  /**
   * Seed 4 attended sessions for one student so recomputeAndAwardStreak awards
   * the 20-pt bonus on the 4th. Returns the 4th session id.
   */
  async function seedStreakBonusStudent(studentId: string): Promise<string> {
    const { batchId, userId, sessionId, scheduledDate } = h.fixtures;
    const dates = ["2026-03-11", "2026-03-12", "2026-03-13", scheduledDate];
    const sessionIds: string[] = [];

    for (const d of dates) {
      if (d === scheduledDate) {
        sessionIds.push(sessionId);
        continue;
      }
      const [existing] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.batch_id, batchId), eq(sessions.scheduled_date, d)))
        .limit(1);
      if (existing) {
        sessionIds.push(existing.id);
        continue;
      }
      const inserted = await db
        .insert(sessions)
        .values({
          batch_id: batchId,
          scheduled_date: d,
          status: "scheduled",
          topic: `Streak seed ${d}`,
        })
        .returning({ id: sessions.id });
      sessionIds.push(inserted[0]!.id);
    }

    for (const sid of sessionIds) {
      const [s] = await db
        .select({ scheduled_date: sessions.scheduled_date })
        .from(sessions)
        .where(eq(sessions.id, sid))
        .limit(1);
      const p = newSubmission([{ student_id: studentId, status: "present" }]);
      await markAttendance({
        sessionId: sid,
        userId,
        markedAt: new Date(markedAtOnSessionDay(s!.scheduled_date, 10)),
        submissionOpId: p.submission_op_id,
        marks: p.marks as never,
      });
    }

    const post = await import("../../src/services/attendance-post-process");
    await post.recomputeAndAwardStreak(studentId);

    const session4 = sessionIds[3]!;
    const awardKey = `attendance_streak:${studentId}:${session4}`;
    const bonus = await db
      .select()
      .from(punya_transactions)
      .where(
        and(
          eq(punya_transactions.student_id, studentId),
          eq(punya_transactions.source_entity_kind, "attendance_streak"),
          eq(punya_transactions.idempotency_key, awardKey),
        ),
      );
    expect(bonus).toHaveLength(1);
    expect(bonus[0]!.points).toBe(20);
    expect(await balanceOf(studentId)).toBe(await sumAllLedger(studentId));
    return session4;
  }

  it(
    "12. streak reversal participates in the marking transaction",
    async () => {
      await resetSessionState();
      const { studentIds, userId, scheduledDate } = h.fixtures;
      const sid = studentIds[6]!;
      const session4 = await seedStreakBonusStudent(sid);

      const p = newSubmission([{ student_id: sid, status: "absent" }]);
      // Today this self-deadlocks; 15s timeout surfaces it instead of hanging the suite.
      await markAttendance({
        sessionId: session4,
        userId,
        markedAt: new Date(markedAtOnSessionDay(scheduledDate, 14)),
        submissionOpId: p.submission_op_id,
        marks: p.marks as never,
      });

      const reversals = await db
        .select()
        .from(punya_transactions)
        .where(
          and(
            eq(punya_transactions.student_id, sid),
            eq(punya_transactions.source_entity_kind, "attendance_streak"),
            sql`${punya_transactions.points} < 0`,
          ),
        );
      expect(reversals).toHaveLength(1);
      expect(reversals[0]!.reversal_of).toBeTruthy();

      const bonus = await db
        .select()
        .from(punya_transactions)
        .where(
          and(
            eq(punya_transactions.student_id, sid),
            eq(punya_transactions.source_entity_kind, "attendance_streak"),
            sql`${punya_transactions.points} > 0`,
          ),
        );
      expect(reversals[0]!.reversal_of).toBe(bonus[0]!.id);
      expect(await balanceOf(sid)).toBe(await sumAllLedger(sid));
    },
    15_000,
  );

  it(
    "13. a rolled-back mark leaves no streak reversal",
    async () => {
      await resetSessionState();
      const { studentIds, userId, scheduledDate } = h.fixtures;
      const sid = studentIds[7]!;
      const session4 = await seedStreakBonusStudent(sid);

      const markMod = await import("../../src/services/attendance-mark");
      markMod.__attendanceMarkTestHooks.throwAfterStreakReversal = true;
      try {
        const p = newSubmission([{ student_id: sid, status: "absent" }]);
        await expect(
          markAttendance({
            sessionId: session4,
            userId,
            markedAt: new Date(markedAtOnSessionDay(scheduledDate, 14)),
            submissionOpId: p.submission_op_id,
            marks: p.marks as never,
          }),
        ).rejects.toThrow(/test-forced rollback/);
      } finally {
        markMod.__attendanceMarkTestHooks.throwAfterStreakReversal = false;
      }

      const reversals = await db
        .select()
        .from(punya_transactions)
        .where(
          and(
            eq(punya_transactions.student_id, sid),
            eq(punya_transactions.source_entity_kind, "attendance_streak"),
            sql`${punya_transactions.points} < 0`,
          ),
        );
      expect(reversals).toHaveLength(0);
      // Bonus still present; attendance still present (txn rolled back).
      const [att] = await db
        .select({ status: attendance.status })
        .from(attendance)
        .where(and(eq(attendance.session_id, session4), eq(attendance.student_id, sid)));
      expect(att?.status).toBe("present");
      expect(await balanceOf(sid)).toBe(await sumAllLedger(sid));
    },
    15_000,
  );
});
