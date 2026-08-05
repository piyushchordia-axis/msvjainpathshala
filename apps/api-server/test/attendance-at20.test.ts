/**
 * PERF #10 safety net — AT17–AT20 / AT4 attendance mark invariants.
 * Run against CURRENT code before any batching changes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  pool,
  db,
  sessions,
  students,
  attendance,
  absence_notifications,
  punya_transactions,
  punya_balances,
  users,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ulid } from "../src/lib/ulid";
import {
  markAttendance,
  sumAttendanceLedger,
} from "../src/services/attendance-mark";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

type Fixture = {
  userId: string;
  sessionId: string;
  scheduledDate: string;
  batchId: string;
  studentIds: string[];
  parentUserId: string;
};

let fx: Fixture;

async function balanceOf(studentId: string): Promise<number> {
  const [row] = await db
    .select({ total_points: punya_balances.total_points })
    .from(punya_balances)
    .where(eq(punya_balances.student_id, studentId))
    .limit(1);
  return row?.total_points ?? 0;
}

async function attendanceTxnCount(sessionId: string, studentIds?: string[]): Promise<number> {
  const rows = await db
    .select({ id: punya_transactions.id })
    .from(punya_transactions)
    .where(
      and(
        eq(punya_transactions.source_entity_kind, "attendance"),
        eq(punya_transactions.source_entity_id, sessionId),
        studentIds ? inArray(punya_transactions.student_id, studentIds) : sql`true`,
      ),
    );
  return rows.length;
}

async function wipeSessionLedger(sessionId: string, studentIds: string[]): Promise<void> {
  await db.delete(attendance).where(eq(attendance.session_id, sessionId));
  await db
    .delete(punya_transactions)
    .where(
      and(
        eq(punya_transactions.source_entity_kind, "attendance"),
        eq(punya_transactions.source_entity_id, sessionId),
      ),
    );
  // Also clear streak rows keyed on this session.
  await db
    .delete(punya_transactions)
    .where(
      and(
        eq(punya_transactions.source_entity_kind, "attendance_streak"),
        eq(punya_transactions.source_entity_id, sessionId),
      ),
    );
  for (const id of studentIds) {
    const ledger = await sumAttendanceLedger(id);
    // Reset balance to attendance-ledger only for these students (test isolation).
    const [other] = await db
      .select({
        sum: sql<number>`coalesce(sum(${punya_transactions.points}), 0)::int`,
      })
      .from(punya_transactions)
      .where(eq(punya_transactions.student_id, id));
    await db
      .insert(punya_balances)
      .values({ student_id: id, total_points: Number(other?.sum ?? 0) })
      .onConflictDoUpdate({
        target: punya_balances.student_id,
        set: { total_points: Number(other?.sum ?? 0), updated_at: new Date() },
      });
    void ledger;
  }
}

function marksPresent(studentIds: string[]) {
  return studentIds.map((id) => ({
    student_id: id,
    status: "present" as const,
    client_op_id: ulid(),
  }));
}

beforeAll(async () => {
  // Prefer a batch that already has a usable roster.
  const batchPick = await pool.query<{ batch_id: string; n: number }>(
    `select batch_id, count(*)::int as n
     from students
     where status = 'active' and batch_id is not null and deleted_at is null
     group by batch_id
     having count(*) >= 5
     order by count(*) desc
     limit 1`,
  );
  expect(batchPick.rows.length).toBe(1);
  const batchId = batchPick.rows[0]!.batch_id;

  const studentRows = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.batch_id, batchId), eq(students.status, "active"), isNull(students.deleted_at)))
    .limit(30);
  expect(studentRows.length).toBeGreaterThanOrEqual(5);

  const [guruji] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .limit(1);
  expect(guruji).toBeTruthy();

  const [parent] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "parent"))
    .limit(1);

  // Far-past date so AT26 window uses that day as marked_at, not colliding with today.
  const scheduledDate = "2024-06-15";
  const [session] = await db
    .insert(sessions)
    .values({
      batch_id: batchId,
      scheduled_date: scheduledDate,
      scheduled_start_time: "10:00:00",
      scheduled_end_time: "11:00:00",
      status: "in_progress",
      topic: "perf10-at20-fixture",
    })
    .onConflictDoUpdate({
      target: [sessions.batch_id, sessions.scheduled_date],
      set: { status: "in_progress", topic: "perf10-at20-fixture" },
    })
    .returning({ id: sessions.id });

  fx = {
    userId: guruji!.id,
    sessionId: session!.id,
    scheduledDate,
    batchId,
    studentIds: studentRows.map((s) => s.id),
    parentUserId: parent?.id ?? guruji!.id,
  };
  await wipeSessionLedger(fx.sessionId, fx.studentIds);
}, 60_000);

describe("AT20 attendance mark invariants (PERF #10 safety net)", () => {
  it("a resubmitted roster awards Punya exactly once (same submission_op_id)", async () => {
    await wipeSessionLedger(fx.sessionId, fx.studentIds);
    const roster = fx.studentIds.slice(0, 5);
    const submissionOpId = ulid();
    const markedAt = new Date(`${fx.scheduledDate}T10:00:00.000+05:30`);
    const body = {
      sessionId: fx.sessionId,
      userId: fx.userId,
      markedAt,
      submissionOpId,
      marks: marksPresent(roster),
    };

    const first = await markAttendance(body);
    expect(first.applied).toBe(roster.length);

    const txnAfterFirst = await attendanceTxnCount(fx.sessionId, roster);
    const balancesAfterFirst = await Promise.all(roster.map(balanceOf));

    const second = await markAttendance(body);
    expect(second).toEqual(first);

    expect(await attendanceTxnCount(fx.sessionId, roster)).toBe(txnAfterFirst);
    const balancesAfterSecond = await Promise.all(roster.map(balanceOf));
    expect(balancesAfterSecond).toEqual(balancesAfterFirst);
  });

  it("a resubmitted roster with a DIFFERENT submission_op_id still awards exactly once", async () => {
    await wipeSessionLedger(fx.sessionId, fx.studentIds);
    const roster = fx.studentIds.slice(0, 5);
    const markedAt = new Date(`${fx.scheduledDate}T10:00:00.000+05:30`);

    await markAttendance({
      sessionId: fx.sessionId,
      userId: fx.userId,
      markedAt,
      submissionOpId: ulid(),
      marks: marksPresent(roster),
    });
    const txnAfterFirst = await attendanceTxnCount(fx.sessionId, roster);
    const balancesAfterFirst = await Promise.all(roster.map(balanceOf));

    const second = await markAttendance({
      sessionId: fx.sessionId,
      userId: fx.userId,
      markedAt: new Date(`${fx.scheduledDate}T11:00:00.000+05:30`),
      submissionOpId: ulid(),
      marks: marksPresent(roster),
    });
    expect(second.applied).toBe(0);
    expect(second.duplicate).toBe(roster.length);
    expect(await attendanceTxnCount(fx.sessionId, roster)).toBe(txnAfterFirst);
    expect(await Promise.all(roster.map(balanceOf))).toEqual(balancesAfterFirst);
  });

  it("present -> absent -> present produces a reverse/award chain, not bare awards", async () => {
    await wipeSessionLedger(fx.sessionId, fx.studentIds);
    const sid = fx.studentIds[0]!;

    const mark = async (status: "present" | "absent", hour: number) => {
      await markAttendance({
        sessionId: fx.sessionId,
        userId: fx.userId,
        markedAt: new Date(`${fx.scheduledDate}T${String(hour).padStart(2, "0")}:00:00.000+05:30`),
        submissionOpId: ulid(),
        marks: [{ student_id: sid, status, client_op_id: ulid() }],
      });
    };

    await mark("present", 9);
    await mark("absent", 10);
    await mark("present", 11);

    const rows = await db
      .select({
        id: punya_transactions.id,
        points: punya_transactions.points,
        reversal_of: punya_transactions.reversal_of,
        idempotency_key: punya_transactions.idempotency_key,
      })
      .from(punya_transactions)
      .where(
        and(
          eq(punya_transactions.student_id, sid),
          eq(punya_transactions.source_entity_kind, "attendance"),
          eq(punya_transactions.source_entity_id, fx.sessionId),
        ),
      )
      .orderBy(punya_transactions.created_at);

    // award + reverse + award
    expect(rows.length).toBe(3);
    expect(rows[0]!.points).toBeGreaterThan(0);
    expect(rows[0]!.reversal_of).toBeNull();
    expect(rows[1]!.points).toBeLessThan(0);
    expect(rows[1]!.reversal_of).toBe(rows[0]!.id);
    expect(rows[2]!.points).toBeGreaterThan(0);
    expect(rows[2]!.reversal_of).toBeNull();

    const awards = rows.filter((r) => r.points > 0);
    expect(await balanceOf(sid)).toBe(awards[awards.length - 1]!.points);
    expect(await sumAttendanceLedger(sid)).toBe(await balanceOf(sid));
  });

  it("a partially-failing roster does not half-apply (per-item reject, siblings commit)", async () => {
    await wipeSessionLedger(fx.sessionId, fx.studentIds);
    const good = fx.studentIds.slice(0, 4);
    const fakeId = "00000000-0000-4000-8000-000000000099";
    const markedAt = new Date(`${fx.scheduledDate}T10:00:00.000+05:30`);

    const res = await markAttendance({
      sessionId: fx.sessionId,
      userId: fx.userId,
      markedAt,
      submissionOpId: ulid(),
      marks: [
        ...marksPresent(good),
        { student_id: fakeId, status: "present", client_op_id: ulid() },
      ],
    });

    expect(res.applied).toBe(good.length);
    expect(res.rejected).toBe(1);
    const rejected = res.items.find((i) => i.result === "rejected");
    expect(rejected).toMatchObject({
      student_id: fakeId,
      code: "ERR_STUDENT_NOT_ENROLLED",
    });

    const rows = await db
      .select({ student_id: attendance.student_id })
      .from(attendance)
      .where(eq(attendance.session_id, fx.sessionId));
    expect(rows.map((r) => r.student_id).sort()).toEqual([...good].sort());
    expect(await attendanceTxnCount(fx.sessionId, good)).toBe(good.length);
  });

  it("absence_notifications are consumed exactly once per covered session (AT4)", async () => {
    await wipeSessionLedger(fx.sessionId, fx.studentIds);
    const sid = fx.studentIds[1]!;

    await db
      .delete(absence_notifications)
      .where(
        and(
          eq(absence_notifications.student_id, sid),
          eq(absence_notifications.start_date, fx.scheduledDate),
        ),
      );

    const [note] = await db
      .insert(absence_notifications)
      .values({
        student_id: sid,
        parent_user_id: fx.parentUserId,
        start_date: fx.scheduledDate,
        end_date: fx.scheduledDate,
        reason: "perf10-at4",
      })
      .returning({ id: absence_notifications.id });

    try {
      await markAttendance({
        sessionId: fx.sessionId,
        userId: fx.userId,
        markedAt: new Date(`${fx.scheduledDate}T10:00:00.000+05:30`),
        submissionOpId: ulid(),
        marks: [{ student_id: sid, status: "excused", client_op_id: ulid() }],
      });

      const [afterFirst] = await db
        .select({ resolved_at: absence_notifications.resolved_at })
        .from(absence_notifications)
        .where(eq(absence_notifications.id, note!.id));
      expect(afterFirst?.resolved_at).toBeTruthy();
      const resolvedAt = afterFirst!.resolved_at;

      // Re-mark same session — must not clear/re-set in a way that double-consumes another row.
      await markAttendance({
        sessionId: fx.sessionId,
        userId: fx.userId,
        markedAt: new Date(`${fx.scheduledDate}T11:00:00.000+05:30`),
        submissionOpId: ulid(),
        marks: [{ student_id: sid, status: "present", client_op_id: ulid() }],
      });

      const open = await db
        .select({ id: absence_notifications.id })
        .from(absence_notifications)
        .where(
          and(eq(absence_notifications.student_id, sid), isNull(absence_notifications.resolved_at)),
        );
      expect(open).toHaveLength(0);

      const [afterSecond] = await db
        .select({ resolved_at: absence_notifications.resolved_at })
        .from(absence_notifications)
        .where(eq(absence_notifications.id, note!.id));
      expect(afterSecond?.resolved_at?.getTime()).toBe(resolvedAt!.getTime());
    } finally {
      await db.delete(absence_notifications).where(eq(absence_notifications.id, note!.id));
    }
  });
});
