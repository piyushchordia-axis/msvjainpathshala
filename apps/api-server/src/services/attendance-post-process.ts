/**
 * attendance.post_process — AT22 streaks, AT31 parent push debounce + admin feed.
 * Delivery is via BullMQ (QUEUE_NAMES.ATTENDANCE_POST_PROCESS / PARENT_NOTIFY).
 *
 * PERF #14 — bound history to STREAK_HISTORY_BOUND eligible sessions; recompute
 * all marked students from one grouped read; batch streak UPDATEs. Parent
 * enqueue stays per student (AT31 debounce jobId). Punya awards stay guarded (AT20).
 */
import {
  db,
  attendance,
  sessions,
  batches,
  centres,
  students,
  centre_holidays,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { awardPunya } from "../lib/punya";
import { STREAK_FEATURE_KEY } from "../lib/punya-streak";
import { notifyUsers } from "../lib/notify";
import { recordAdminAttendanceMark } from "../lib/admin-dashboard-feed";
import { enqueueDebouncedJob } from "../lib/queues";
import { QUEUE_NAMES } from "@jp/shared/constants";
import {
  computeAttendanceStreak,
  STREAK_EVERY,
  STREAK_HISTORY_BOUND,
  type StreakEligibleMark,
} from "../lib/attendance-streak-math";

export { STREAK_FEATURE_KEY };
export const STREAK_BONUS_POINTS = 20;
export { STREAK_EVERY };

/** AT31 — parent "attendance marked" settles for 5 minutes per (student, session). */
export const PARENT_PUSH_DEBOUNCE_MS = 5 * 60 * 1000;

function kolkataDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

/** Deliver the debounced parent push (queue handler entry point). */
export async function sendParentAttendancePush(
  studentId: string,
  sessionId: string,
): Promise<void> {
  const [row] = await db
    .select({
      parent_id: students.parent_id,
      full_name: students.full_name,
      session_date: sessions.scheduled_date,
      status: attendance.status,
    })
    .from(students)
    .innerJoin(
      attendance,
      and(
        eq(attendance.student_id, students.id),
        eq(attendance.session_id, sessionId),
        eq(attendance.student_id, studentId),
      ),
    )
    .innerJoin(sessions, eq(sessions.id, sessionId))
    .where(eq(students.id, studentId))
    .limit(1);

  if (!row?.parent_id) return;

  // Prefs (including push / attendance opt-out) gated inside notifyUsers.
  await notifyUsers({
    userIds: [row.parent_id],
    kind: "attendance",
    title_en: "Attendance marked",
    title_hi: "उपस्थिति दर्ज",
    body_en: `${row.full_name}: ${row.status} on ${row.session_date}`,
    body_hi: `${row.full_name}: ${row.session_date} को ${row.status}`,
    push: true,
    data: { kind: "attendance", session_id: sessionId, student_id: studentId },
  });
}

/** Sliding 5-minute debounce on QUEUE_NAMES.PARENT_NOTIFY. */
export async function enqueueParentAttendanceNotify(
  studentId: string,
  sessionId: string,
): Promise<void> {
  await enqueueDebouncedJob(
    QUEUE_NAMES.PARENT_NOTIFY,
    {
      kind: "attendance_marked",
      student_id: studentId,
      session_id: sessionId,
    },
    {
      jobId: `attn-parent:${studentId}:${sessionId}`,
      delayMs: PARENT_PUSH_DEBOUNCE_MS,
    },
  );
}

/**
 * Recompute streak from chronological eligible marks (bounded), persist, and
 * award repeating 20-pt bonuses (AT22). Idempotency key includes triggering session_id.
 */
export async function recomputeAndAwardStreak(studentId: string): Promise<number> {
  const [stu] = await db
    .select({
      id: students.id,
      batch_id: students.batch_id,
      centre_id: students.centre_id,
      deactivated_at: students.deactivated_at,
    })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!stu?.batch_id) return 0;

  const holidayRows = stu.centre_id
    ? await db
        .select({ holiday_date: centre_holidays.holiday_date })
        .from(centre_holidays)
        .where(eq(centre_holidays.centre_id, stu.centre_id))
    : [];
  const holidays = new Set(holidayRows.map((h) => h.holiday_date));

  // Bound: last N sessions on the batch (cancelled/holiday filtered in JS after).
  // Fetch a cushion so holiday/cancelled rows do not starve the eligible bound.
  const sessionWindow = await db
    .select({
      session_id: sessions.id,
      scheduled_date: sessions.scheduled_date,
      session_status: sessions.status,
    })
    .from(sessions)
    .where(eq(sessions.batch_id, stu.batch_id))
    .orderBy(desc(sessions.scheduled_date), desc(sessions.id))
    .limit(STREAK_HISTORY_BOUND * 2);

  const eligibleSessionIds: string[] = [];
  const sessionMeta = new Map<string, { scheduled_date: string; session_status: string }>();
  for (const s of sessionWindow) {
    if (s.session_status === "cancelled") continue;
    if (holidays.has(s.scheduled_date)) continue;
    if (
      stu.deactivated_at &&
      s.scheduled_date >= kolkataDate(stu.deactivated_at)
    ) {
      continue;
    }
    eligibleSessionIds.push(s.session_id);
    sessionMeta.set(s.session_id, {
      scheduled_date: s.scheduled_date,
      session_status: s.session_status,
    });
    if (eligibleSessionIds.length >= STREAK_HISTORY_BOUND) break;
  }

  if (eligibleSessionIds.length === 0) {
    await db
      .update(students)
      .set({ attendance_streak: 0, attendance_streak_updated_at: new Date() })
      .where(eq(students.id, studentId));
    return 0;
  }

  const marks = await db
    .select({
      session_id: attendance.session_id,
      status: attendance.status,
      scheduled_date: sessions.scheduled_date,
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.session_id))
    .where(
      and(
        eq(attendance.student_id, studentId),
        inArray(attendance.session_id, eligibleSessionIds),
      ),
    )
    .orderBy(asc(sessions.scheduled_date), asc(sessions.id));

  const eligible: StreakEligibleMark[] = marks.map((m) => ({
    session_id: m.session_id,
    status: m.status,
  }));

  const { streak, milestoneSessionIds } = computeAttendanceStreak(eligible);

  await db
    .update(students)
    .set({
      attendance_streak: streak,
      attendance_streak_updated_at: new Date(),
    })
    .where(eq(students.id, studentId));

  for (const sessionId of milestoneSessionIds) {
    const key = `attendance_streak:${studentId}:${sessionId}`;
    await awardPunya({
      studentId,
      featureKey: STREAK_FEATURE_KEY,
      points: STREAK_BONUS_POINTS,
      note: "Attendance streak bonus (every 4 attended)",
      idempotencyKey: key,
      sourceEntityKind: "attendance_streak",
      sourceEntityId: sessionId,
    });
  }

  void sessionMeta;
  return streak;
}

/**
 * Session-level post-process: streak recompute (throws on failure so BullMQ
 * retries) + parent-notify enqueue + admin aggregate tick.
 */
export async function runAttendancePostProcess(sessionId: string): Promise<void> {
  const marked = await db
    .select({
      student_id: attendance.student_id,
      status: attendance.status,
      centre_id: batches.centre_id,
      city_id: centres.city_id,
      batch_id: sessions.batch_id,
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.session_id))
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(attendance.session_id, sessionId));

  if (marked.length === 0) return;

  const batchId = marked[0]!.batch_id;
  const centreId = marked[0]!.centre_id;
  const studentIds = [...new Set(marked.map((m) => m.student_id))];

  const holidayRows = centreId
    ? await db
        .select({ holiday_date: centre_holidays.holiday_date })
        .from(centre_holidays)
        .where(eq(centre_holidays.centre_id, centreId))
    : [];
  const holidays = new Set(holidayRows.map((h) => h.holiday_date));

  const stuRows = await db
    .select({
      id: students.id,
      deactivated_at: students.deactivated_at,
    })
    .from(students)
    .where(inArray(students.id, studentIds));
  const deactivatedAt = new Map(
    stuRows.map((s) => [s.id, s.deactivated_at] as const),
  );

  const sessionWindow = await db
    .select({
      session_id: sessions.id,
      scheduled_date: sessions.scheduled_date,
      session_status: sessions.status,
    })
    .from(sessions)
    .where(eq(sessions.batch_id, batchId))
    .orderBy(desc(sessions.scheduled_date), desc(sessions.id))
    .limit(STREAK_HISTORY_BOUND * 2);

  const eligibleSessions: Array<{ session_id: string; scheduled_date: string }> = [];
  for (const s of sessionWindow) {
    if (s.session_status === "cancelled") continue;
    if (holidays.has(s.scheduled_date)) continue;
    eligibleSessions.push({ session_id: s.session_id, scheduled_date: s.scheduled_date });
    if (eligibleSessions.length >= STREAK_HISTORY_BOUND) break;
  }

  // Chronological for streak math.
  eligibleSessions.reverse();
  const eligibleIds = eligibleSessions.map((s) => s.session_id);

  const marksByStudent = new Map<string, StreakEligibleMark[]>();
  for (const id of studentIds) marksByStudent.set(id, []);

  if (eligibleIds.length > 0) {
    const allMarks = await db
      .select({
        student_id: attendance.student_id,
        session_id: attendance.session_id,
        status: attendance.status,
        scheduled_date: sessions.scheduled_date,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.session_id))
      .where(
        and(
          inArray(attendance.student_id, studentIds),
          inArray(attendance.session_id, eligibleIds),
        ),
      )
      .orderBy(asc(sessions.scheduled_date), asc(sessions.id));

    for (const m of allMarks) {
      const deact = deactivatedAt.get(m.student_id);
      if (deact && m.scheduled_date >= kolkataDate(deact)) continue;
      const list = marksByStudent.get(m.student_id);
      if (list) list.push({ session_id: m.session_id, status: m.status });
    }
  }

  const streakUpdates: Array<{ student_id: string; streak: number }> = [];
  const awards: Array<{ studentId: string; sessionId: string }> = [];

  for (const studentId of studentIds) {
    const { streak, milestoneSessionIds } = computeAttendanceStreak(
      marksByStudent.get(studentId) ?? [],
    );
    streakUpdates.push({ student_id: studentId, streak });
    for (const sid of milestoneSessionIds) {
      awards.push({ studentId, sessionId: sid });
    }
  }

  if (streakUpdates.length > 0) {
    const idLiterals = sql.join(
      streakUpdates.map((u) => sql`${u.student_id}::uuid`),
      sql`, `,
    );
    const streakLiterals = sql.join(
      streakUpdates.map((u) => sql`${u.streak}::int`),
      sql`, `,
    );
    await db.execute(sql`
      update students as s
         set attendance_streak = v.streak,
             attendance_streak_updated_at = now()
        from (
          select *
          from unnest(
            array[${idLiterals}]::uuid[],
            array[${streakLiterals}]::int[]
          ) as t(student_id, streak)
        ) as v
       where s.id = v.student_id
    `);
  }

  // AT20 — one guarded award per milestone (do not batch into an unguarded write).
  for (const a of awards) {
    await awardPunya({
      studentId: a.studentId,
      featureKey: STREAK_FEATURE_KEY,
      points: STREAK_BONUS_POINTS,
      note: "Attendance streak bonus (every 4 attended)",
      idempotencyKey: `attendance_streak:${a.studentId}:${a.sessionId}`,
      sourceEntityKind: "attendance_streak",
      sourceEntityId: a.sessionId,
    });
  }

  // AT31 — distinct jobIds per (student, session); leave the loop (addBulk would
  // need the same per-id debounce remove/re-add which BullMQ addBulk does not preserve).
  for (const row of marked) {
    await enqueueParentAttendanceNotify(row.student_id, sessionId);
    if (row.city_id) {
      recordAdminAttendanceMark(row.city_id);
    }
  }
}
