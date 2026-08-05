/**
 * Shared session roster + AT4 absence pre-fill (used by GET /v1/sessions/today
 * and GET /v1/admin/attendance/centres/:id/log).
 */
import {
  db,
  students,
  attendance,
  absence_notifications,
  sessions,
  batches,
  centres,
} from "@workspace/db";
import { and, eq, inArray, isNull, lte, gte, asc } from "drizzle-orm";

export type RosterEntry = {
  student_id: string;
  full_name: string;
  student_code: string;
  status: string | null;
  marked_method: string | null;
  suggested_status: "excused" | null;
  absence_reason: string | null;
};

function mapRosterRow(r: {
  student_id: string;
  full_name: string;
  student_code: string;
  status: string | null;
  marked_method: string | null;
  absence_reason: string | null;
  absence_id: string | null;
}): RosterEntry {
  const suggested =
    !r.status && r.absence_id
      ? ({ status: "excused" as const, reason: r.absence_reason })
      : null;
  return {
    student_id: r.student_id,
    full_name: r.full_name,
    student_code: r.student_code,
    status: r.status,
    marked_method: r.marked_method,
    suggested_status: suggested?.status ?? null,
    absence_reason: suggested?.reason ?? null,
  };
}

export async function loadSessionRoster(
  sessionId: string,
  sessionDate: string,
  batchId: string,
): Promise<RosterEntry[]> {
  const rosterRows = await db
    .select({
      student_id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      status: attendance.status,
      marked_method: attendance.marked_method,
      absence_reason: absence_notifications.reason,
      absence_id: absence_notifications.id,
    })
    .from(students)
    .leftJoin(
      attendance,
      and(eq(attendance.student_id, students.id), eq(attendance.session_id, sessionId)),
    )
    .leftJoin(
      absence_notifications,
      and(
        eq(absence_notifications.student_id, students.id),
        isNull(absence_notifications.resolved_at),
        lte(absence_notifications.start_date, sessionDate),
        gte(absence_notifications.end_date, sessionDate),
      ),
    )
    .where(and(eq(students.batch_id, batchId), eq(students.status, "active")))
    .orderBy(asc(students.full_name));

  return rosterRows.map(mapRosterRow);
}

/**
 * Bounded roster load for many sessions: 3 queries total (students, attendance,
 * absences), then group in JS — replaces N× loadSessionRoster.
 */
export async function loadRostersForSessions(
  sessionKeys: Array<{ session_id: string; session_date: string; batch_id: string }>,
): Promise<Map<string, RosterEntry[]>> {
  const out = new Map<string, RosterEntry[]>();
  if (sessionKeys.length === 0) return out;

  const batchIds = [...new Set(sessionKeys.map((s) => s.batch_id))];
  const sessionIds = sessionKeys.map((s) => s.session_id);

  const studentRows = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      batch_id: students.batch_id,
    })
    .from(students)
    .where(and(inArray(students.batch_id, batchIds), eq(students.status, "active")))
    .orderBy(asc(students.full_name));

  const attendanceRows = await db
    .select({
      session_id: attendance.session_id,
      student_id: attendance.student_id,
      status: attendance.status,
      marked_method: attendance.marked_method,
    })
    .from(attendance)
    .where(inArray(attendance.session_id, sessionIds));

  const attBySessionStudent = new Map<string, { status: string; marked_method: string | null }>();
  for (const a of attendanceRows) {
    attBySessionStudent.set(`${a.session_id}:${a.student_id}`, {
      status: a.status,
      marked_method: a.marked_method,
    });
  }

  const studentIds = studentRows.map((s) => s.id);
  const absenceRows =
    studentIds.length === 0
      ? []
      : await db
          .select({
            id: absence_notifications.id,
            student_id: absence_notifications.student_id,
            reason: absence_notifications.reason,
            start_date: absence_notifications.start_date,
            end_date: absence_notifications.end_date,
          })
          .from(absence_notifications)
          .where(
            and(
              inArray(absence_notifications.student_id, studentIds),
              isNull(absence_notifications.resolved_at),
            ),
          );

  const studentsByBatch = new Map<string, typeof studentRows>();
  for (const s of studentRows) {
    if (!s.batch_id) continue;
    const list = studentsByBatch.get(s.batch_id) ?? [];
    list.push(s);
    studentsByBatch.set(s.batch_id, list);
  }

  for (const key of sessionKeys) {
    const batchStudents = studentsByBatch.get(key.batch_id) ?? [];
    const roster: RosterEntry[] = batchStudents.map((s) => {
      const att = attBySessionStudent.get(`${key.session_id}:${s.id}`);
      const covering = absenceRows.find(
        (a) =>
          a.student_id === s.id &&
          String(a.start_date) <= key.session_date &&
          String(a.end_date) >= key.session_date,
      );
      return mapRosterRow({
        student_id: s.id,
        full_name: s.full_name,
        student_code: s.student_code,
        status: att?.status ?? null,
        marked_method: att?.marked_method ?? null,
        absence_reason: covering?.reason ?? null,
        absence_id: covering?.id ?? null,
      });
    });
    out.set(key.session_id, roster);
  }

  return out;
}

export async function loadSessionDetail(sessionId: string) {
  const [session] = await db
    .select({
      id: sessions.id,
      batch_id: sessions.batch_id,
      session_date: sessions.scheduled_date,
      status: sessions.status,
      topic: sessions.topic,
      gps_required: sessions.gps_required,
      centre_id: batches.centre_id,
      batch_name: batches.name,
      centre_name: centres.name,
      centre_lat: centres.lat,
      centre_lng: centres.lng,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!session) return null;
  const roster = await loadSessionRoster(session.id, session.session_date, session.batch_id);
  return {
    session: {
      id: session.id,
      batch_id: session.batch_id,
      session_date: session.session_date,
      status: session.status,
      topic: session.topic,
      gps_required: session.gps_required,
      batch_name: session.batch_name,
      centre_name: session.centre_name,
      centre_id: session.centre_id,
      has_gps: session.centre_lat !== null && session.centre_lng !== null,
    },
    roster,
  };
}
