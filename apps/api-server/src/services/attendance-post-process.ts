/**
 * attendance.post_process — AT22 streaks, AT31 parent push debounce + admin feed.
 * Delivery is via BullMQ (QUEUE_NAMES.ATTENDANCE_POST_PROCESS / PARENT_NOTIFY).
 */
import {
  db,
  attendance,
  sessions,
  batches,
  centres,
  students,
  centre_holidays,
  users,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { awardPunya } from "../lib/punya";
import { STREAK_FEATURE_KEY } from "../lib/punya-streak";
import { notifyUsers } from "../lib/notify";
import { recordAdminAttendanceMark } from "../lib/admin-dashboard-feed";
import { enqueueDebouncedJob } from "../lib/queues";
import { QUEUE_NAMES } from "@jp/shared/constants";

export { STREAK_FEATURE_KEY };
export const STREAK_BONUS_POINTS = 20;
const STREAK_EVERY = 4;

/** AT31 — parent "attendance marked" settles for 5 minutes per (student, session). */
export const PARENT_PUSH_DEBOUNCE_MS = 5 * 60 * 1000;

function prefsAllowAttendance(prefs: unknown): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  const p = prefs as Record<string, unknown>;
  if (p.attendance === false) return false;
  if (p.push === false) return false;
  return true;
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
      prefs: users.notification_preferences,
      session_date: sessions.scheduled_date,
      status: attendance.status,
    })
    .from(students)
    .innerJoin(
      attendance,
      and(eq(attendance.student_id, students.id), eq(attendance.session_id, sessionId)),
    )
    .innerJoin(sessions, eq(sessions.id, sessionId))
    .leftJoin(users, eq(users.id, students.parent_id))
    .limit(1);

  if (!row?.parent_id) return;
  if (!prefsAllowAttendance(row.prefs)) return;

  await notifyUsers({
    userIds: [row.parent_id],
    kind: "general",
    title_en: "Attendance marked",
    title_hi: "उपस्थिति दर्ज",
    body_en: `${row.full_name}: ${row.status} on ${row.session_date}`,
    body_hi: `${row.full_name}: ${row.session_date} को ${row.status}`,
    push: true,
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

type StreakSession = {
  session_id: string;
  scheduled_date: string;
  status: string;
};

/**
 * Recompute streak from chronological eligible marks, persist, and award
 * repeating 20-pt bonuses (AT22). Idempotency key includes triggering session_id.
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

  const rows = await db
    .select({
      session_id: sessions.id,
      scheduled_date: sessions.scheduled_date,
      session_status: sessions.status,
      status: attendance.status,
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.session_id))
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .where(and(eq(attendance.student_id, studentId), eq(sessions.batch_id, stu.batch_id)))
    .orderBy(asc(sessions.scheduled_date), asc(sessions.id));

  const eligible: StreakSession[] = [];
  for (const r of rows) {
    if (r.session_status === "cancelled") continue;
    if (holidays.has(r.scheduled_date)) continue;
    if (
      stu.deactivated_at &&
      r.scheduled_date >=
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(stu.deactivated_at)
    ) {
      continue;
    }
    eligible.push({
      session_id: r.session_id,
      scheduled_date: r.scheduled_date,
      status: r.status,
    });
  }

  let streak = 0;
  const milestoneSessions: string[] = [];
  for (const e of eligible) {
    if (e.status === "excused") continue;
    if (e.status === "absent") {
      streak = 0;
      continue;
    }
    if (e.status === "present" || e.status === "late") {
      streak += 1;
      if (streak > 0 && streak % STREAK_EVERY === 0) {
        milestoneSessions.push(e.session_id);
      }
    }
  }

  await db
    .update(students)
    .set({
      attendance_streak: streak,
      attendance_streak_updated_at: new Date(),
    })
    .where(eq(students.id, studentId));

  for (const sessionId of milestoneSessions) {
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
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.session_id))
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(attendance.session_id, sessionId));

  for (const row of marked) {
    // Do not swallow — failed streak must surface on the queue job.
    await recomputeAndAwardStreak(row.student_id);
    await enqueueParentAttendanceNotify(row.student_id, sessionId);
    if (row.city_id) {
      recordAdminAttendanceMark(row.city_id);
    }
  }
}
