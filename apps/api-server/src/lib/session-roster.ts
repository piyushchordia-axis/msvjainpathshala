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
import { and, eq, isNull, lte, gte, asc } from "drizzle-orm";

export async function loadSessionRoster(sessionId: string, sessionDate: string, batchId: string) {
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

  return rosterRows.map((r) => {
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
  });
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
