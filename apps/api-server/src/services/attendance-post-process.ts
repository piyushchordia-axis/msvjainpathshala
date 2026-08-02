/**
 * attendance.post_process — AT22 streaks, AT31 parent push debounce + admin feed.
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
import { and, asc, eq, sql } from "drizzle-orm";
import { awardPunya } from "../lib/punya";
import { notifyUsers } from "../lib/notify";
import { logger } from "../lib/logger";
import { recordAdminAttendanceMark } from "../lib/admin-dashboard-feed";
import { attendanceEvents } from "./attendance-mark";

export const STREAK_FEATURE_KEY = "attendance_streak";
export const STREAK_BONUS_POINTS = 20;
const STREAK_EVERY = 4;

/** AT31 — parent "attendance marked" settles for 5 minutes per (student, session). */
const PARENT_PUSH_DEBOUNCE_MS = 5 * 60 * 1000;

const parentNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>();

function parentNotifyKey(studentId: string, sessionId: string): string {
  return `${studentId}:${sessionId}`;
}

export function enqueueParentAttendanceNotify(studentId: string, sessionId: string): void {
  const key = parentNotifyKey(studentId, sessionId);
  const prev = parentNotifyTimers.get(key);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    parentNotifyTimers.delete(key);
    void sendParentAttendancePush(studentId, sessionId).catch((err) =>
      logger.warn({ err, studentId, sessionId }, "parent attendance push failed"),
    );
  }, PARENT_PUSH_DEBOUNCE_MS);
  if (typeof t === "object" && "unref" in t) (t as NodeJS.Timeout).unref();
  parentNotifyTimers.set(key, t);
}

function prefsAllowAttendance(prefs: unknown): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  const p = prefs as Record<string, unknown>;
  if (p.attendance === false) return false;
  if (p.push === false) return false;
  return true;
}

async function sendParentAttendancePush(studentId: string, sessionId: string): Promise<void> {
  const [row] = await db
    .select({
      parent_id: students.parent_id,
      full_name: students.full_name,
      prefs: users.notification_preferences,
      session_date: sessions.scheduled_date,
      status: attendance.status,
    })
    .from(students)
    .innerJoin(attendance, and(eq(attendance.student_id, students.id), eq(attendance.session_id, sessionId)))
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

/** Reverse streak bonus tied to a session (correction / force_cancel). */
export async function reverseStreakBonusForSession(
  studentId: string,
  sessionId: string,
  revision: number,
): Promise<void> {
  const awardKey = `attendance_streak:${studentId}:${sessionId}`;
  const revKey = `attendance_streak:${studentId}:${sessionId}:rev:${revision}`;

  const result = await db.execute(sql`
    with prior as (
      select t.id, t.points
      from punya_transactions t
      where t.student_id = ${studentId}::uuid
        and t.source_entity_kind = 'attendance_streak'
        and t.source_entity_id = ${sessionId}::uuid
        and t.points > 0
        and t.idempotency_key = ${awardKey}
        and not exists (select 1 from punya_transactions r where r.reversal_of = t.id)
      limit 1
    ),
    ins as (
      insert into punya_transactions (
        student_id, feature_key, points, note,
        idempotency_key, reversal_of, source_entity_kind, source_entity_id
      )
      select
        ${studentId}::uuid, ${STREAK_FEATURE_KEY}, -prior.points,
        'attendance streak reversal',
        ${revKey}, prior.id, 'attendance_streak', ${sessionId}::uuid
      from prior
      on conflict (idempotency_key) where idempotency_key is not null
      do nothing
      returning points
    )
    select coalesce((select points from ins), 0) as points
  `);
  const rows = (result as unknown as { rows?: Array<{ points: number }> }).rows ?? [];
  const delta = Number(rows[0]?.points ?? 0);
  if (delta !== 0) {
    await db.execute(sql`
      insert into punya_balances (student_id, total_points)
      values (${studentId}::uuid, ${delta})
      on conflict (student_id) do update
        set total_points = punya_balances.total_points + ${delta},
            updated_at = now()
    `);
  }
}

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
    try {
      await recomputeAndAwardStreak(row.student_id);
    } catch (err) {
      logger.warn({ err, studentId: row.student_id }, "streak recompute failed");
    }
    enqueueParentAttendanceNotify(row.student_id, sessionId);
    if (row.city_id) {
      recordAdminAttendanceMark(row.city_id);
    }
  }
}

let listenersBound = false;

/** Wire EventEmitter → post-process (idempotent). */
export function bindAttendancePostProcessListeners(): void {
  if (listenersBound) return;
  listenersBound = true;
  attendanceEvents.on("attendance.post_process", (payload: { session_id: string }) => {
    void runAttendancePostProcess(payload.session_id).catch((err) =>
      logger.warn({ err, sessionId: payload.session_id }, "attendance.post_process failed"),
    );
  });
}
