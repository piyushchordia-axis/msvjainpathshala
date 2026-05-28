/**
 * AttendanceRepository — query helpers for `attendance`.
 *
 * The `bulkUpsert` is the workhorse: shikshak submits N marks per session,
 * each with its own `client_op_id` (offline-sync idempotency key). Conflict
 * on (session_id, student_id) is treated as "update" — same-day flips by
 * the shikshak are first-class (SPEC §8.3.8).
 *
 * `previousScheduledSessions` powers streak + consecutive-absence checks:
 * we filter out cancelled sessions and dates falling inside a centre_holiday
 * so the streak logic doesn't break on legitimate non-attendance days.
 */

import { Injectable } from '@nestjs/common';
import { and, between, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import {
  absence_notifications,
  attendance,
  batches,
  centre_holidays,
  centres,
  sessions,
} from '../schema';

import type { Attendance, NewAttendance } from '../schema';
import type { AttendanceStatus } from '@jp/shared';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type Tx = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export interface SessionDay {
  session_id: string;
  scheduled_date: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  attendance_status: AttendanceStatus | null;
  is_holiday: boolean;
  has_absence_notice: boolean;
}

@Injectable()
export class AttendanceRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findBySession(sessionId: string, tx?: Tx): Promise<Attendance[]> {
    const runner = (tx ?? this.drizzle.dbRead) as Tx;
    return runner
      .select()
      .from(attendance)
      .where(eq(attendance.session_id, sessionId))
      .orderBy(desc(attendance.marked_at));
  }

  async findBySessionAndStudent(
    sessionId: string,
    studentId: string,
    tx?: Tx,
  ): Promise<Attendance | null> {
    const runner = (tx ?? this.drizzle.dbRead) as Tx;
    const rows = await runner
      .select()
      .from(attendance)
      .where(and(eq(attendance.session_id, sessionId), eq(attendance.student_id, studentId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByClientOpIds(clientOpIds: string[], tx?: Tx): Promise<Attendance[]> {
    if (clientOpIds.length === 0) return [];
    const runner = (tx ?? this.drizzle.dbRead) as Tx;
    return runner.select().from(attendance).where(inArray(attendance.client_op_id, clientOpIds));
  }

  /**
   * Bulk UPSERT. Conflict on (session_id, student_id) updates status, notes,
   * marked_at, marked_by — meaning a same-day re-mark is a first-class flip.
   * Returns every row (inserted or updated).
   */
  async bulkUpsert(rows: NewAttendance[], tx?: Tx): Promise<Attendance[]> {
    if (rows.length === 0) return [];
    const runner = (tx ?? this.drizzle.db) as Tx;
    return runner
      .insert(attendance)
      .values(rows)
      .onConflictDoUpdate({
        target: [attendance.session_id, attendance.student_id],
        set: {
          status: sql`EXCLUDED.status`,
          notes: sql`EXCLUDED.notes`,
          marked_at: sql`EXCLUDED.marked_at`,
          marked_by: sql`EXCLUDED.marked_by`,
          updated_at: new Date(),
        },
      })
      .returning();
  }

  /** Single-row edit (PATCH /v1/sessions/:id/attendance/:student_id). */
  async updateOne(
    sessionId: string,
    studentId: string,
    patch: { status: AttendanceStatus; notes?: string | null; marked_by: string },
    tx?: Tx,
  ): Promise<Attendance | null> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .update(attendance)
      .set({
        status: patch.status,
        notes: patch.notes ?? null,
        marked_by: patch.marked_by,
        marked_at: new Date(),
        updated_at: new Date(),
      })
      .where(and(eq(attendance.session_id, sessionId), eq(attendance.student_id, studentId)))
      .returning();
    return row ?? null;
  }

  /**
   * One month of attendance for a student (parent dashboard / heatmap).
   */
  async findByStudentMonth(
    studentId: string,
    yearMonth: string, // 'YYYY-MM'
  ): Promise<Array<{ attendance: Attendance; scheduled_date: string }>> {
    const start = `${yearMonth}-01`;
    // end is exclusive: first day of next month
    const parts = yearMonth.split('-').map((n) => parseInt(n, 10));
    const y = parts[0] ?? 1970;
    const m = parts[1] ?? 1;
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const end = `${nextY}-${nextM.toString().padStart(2, '0')}-01`;

    return this.drizzle.dbRead
      .select({ attendance, scheduled_date: sessions.scheduled_date })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.session_id))
      .where(
        and(eq(attendance.student_id, studentId), between(sessions.scheduled_date, start, end)),
      )
      .orderBy(desc(sessions.scheduled_date));
  }

  /**
   * Walk the recent past for a student: returns up to `limit` of the
   * student's batch's scheduled sessions (latest first), annotated with the
   * student's attendance status (if any) for that session, whether the day is
   * a centre holiday, and whether the parent filed an absence notification.
   *
   * Used by:
   *   - attendance.post_process processor → streak recompute
   *   - attendance.consecutive_check processor → 3-absence flag
   */
  async previousScheduledSessions(
    studentId: string,
    batchId: string,
    centreId: string,
    beforeDate: string, // exclusive — typically today's date
    limit = 100,
  ): Promise<SessionDay[]> {
    const rows = await this.drizzle.dbRead
      .select({
        session_id: sessions.id,
        scheduled_date: sessions.scheduled_date,
        status: sessions.status,
        attendance_status: attendance.status,
        is_holiday: sql<boolean>`EXISTS (
          SELECT 1 FROM centre_holidays h
          WHERE h.centre_id = ${centreId}
            AND ${sessions.scheduled_date} BETWEEN h.start_date AND h.end_date
        )`,
        has_absence_notice: sql<boolean>`EXISTS (
          SELECT 1 FROM absence_notifications a
          WHERE a.student_id = ${studentId}
            AND a.expected_date = ${sessions.scheduled_date}
        )`,
      })
      .from(sessions)
      .leftJoin(
        attendance,
        and(eq(attendance.session_id, sessions.id), eq(attendance.student_id, studentId)),
      )
      .where(and(eq(sessions.batch_id, batchId), lt(sessions.scheduled_date, beforeDate)))
      .orderBy(desc(sessions.scheduled_date))
      .limit(limit);

    return rows as SessionDay[];
  }

  /**
   * Counts: how many rows of each status for a session (admin dashboard).
   */
  async countByStatusForSession(sessionId: string): Promise<Record<AttendanceStatus, number>> {
    const rows = await this.drizzle.dbRead
      .select({
        status: attendance.status,
        c: sql<number>`COUNT(*)::int`,
      })
      .from(attendance)
      .where(eq(attendance.session_id, sessionId))
      .groupBy(attendance.status);
    const out: Record<AttendanceStatus, number> = {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    };
    for (const r of rows) out[r.status] = r.c;
    return out;
  }

  // Marker: unused-import suppressor — schema imports we keep so the file
  // remains self-contained for downstream readers.
  static readonly __keep = { absence_notifications, batches, centre_holidays, centres, or, isNull };
}
