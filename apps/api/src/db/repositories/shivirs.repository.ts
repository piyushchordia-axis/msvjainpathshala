/**
 * ShivirsRepository — query helpers for the five Shivir tables.
 *
 *   shivir_events
 *   shivir_sessions
 *   shivir_registrations
 *   shivir_volunteers
 *   shivir_attendance_scans
 *
 * The repository is intentionally thin: each method is a single SQL
 * statement / Drizzle query, and ALL transactional / business-rule logic
 * lives in ShivirsService.
 *
 * Notable methods:
 *   - `latestScanFor(session_id, student_id)` powers the in/out state
 *     machine — service inspects the returned scan_kind to decide whether
 *     the next scan inserts `check_in`, `check_out`, or 409s.
 *   - `liveCounters(event_id, session_id?)` computes the four-counter
 *     payload the live admin dashboard needs (Registered / Currently In /
 *     Already Out / Not Arrived) in a single query.
 *   - `findRegistrationsByEventStudentIds` powers the bulk-registration
 *     idempotency check (re-registering an already-registered student is
 *     a no-op rather than a 409).
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import {
  shivir_attendance_scans,
  shivir_events,
  shivir_registrations,
  shivir_sessions,
  shivir_volunteers,
  students,
} from '../schema';

import type {
  NewShivirAttendanceScan,
  NewShivirEvent,
  NewShivirRegistration,
  NewShivirSession,
  NewShivirVolunteer,
  ShivirAttendanceScan,
  ShivirEvent,
  ShivirRegistration,
  ShivirSession,
  ShivirVolunteer,
} from '../schema';
import type { ShivirAttendanceMode, ShivirScanKind } from '@jp/shared';

export interface LiveCounters {
  registered: number;
  currently_in: number;
  already_out: number;
  not_arrived: number;
}

export interface ScanLogRow {
  scan: ShivirAttendanceScan;
  student_full_name: string;
  student_code: string;
}

@Injectable()
export class ShivirsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // ===========================================================================
  // shivir_events
  // ===========================================================================

  async createEvent(input: NewShivirEvent): Promise<ShivirEvent> {
    const [row] = await this.drizzle.db.insert(shivir_events).values(input).returning();
    if (!row) throw new Error('[shivirs.createEvent] INSERT returned no row');
    return row;
  }

  async findEventById(id: string): Promise<ShivirEvent | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(shivir_events)
      .where(and(eq(shivir_events.id, id), isNull(shivir_events.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listEvents(filters: {
    city_ids?: string[];
    msv_only?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ShivirEvent[]> {
    const where = [isNull(shivir_events.deleted_at)];
    if (filters.city_ids?.length) where.push(inArray(shivir_events.city_id, filters.city_ids));
    if (filters.msv_only !== undefined) where.push(eq(shivir_events.msv_only, filters.msv_only));
    return this.drizzle.dbRead
      .select()
      .from(shivir_events)
      .where(and(...where))
      .orderBy(desc(shivir_events.start_date))
      .limit(Math.min(filters.limit ?? 50, 200))
      .offset(filters.offset ?? 0);
  }

  // ===========================================================================
  // shivir_sessions
  // ===========================================================================

  async createSession(input: NewShivirSession): Promise<ShivirSession> {
    const [row] = await this.drizzle.db.insert(shivir_sessions).values(input).returning();
    if (!row) throw new Error('[shivirs.createSession] INSERT returned no row');
    return row;
  }

  async findSessionById(id: string): Promise<ShivirSession | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(shivir_sessions)
      .where(eq(shivir_sessions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listSessionsForEvent(eventId: string): Promise<ShivirSession[]> {
    return this.drizzle.dbRead
      .select()
      .from(shivir_sessions)
      .where(eq(shivir_sessions.shivir_event_id, eventId))
      .orderBy(shivir_sessions.day_number);
  }

  // ===========================================================================
  // shivir_registrations
  // ===========================================================================

  async findRegistrationByEventStudent(
    eventId: string,
    studentId: string,
  ): Promise<ShivirRegistration | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(shivir_registrations)
      .where(
        and(
          eq(shivir_registrations.shivir_event_id, eventId),
          eq(shivir_registrations.student_id, studentId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findRegistrationsByEventStudentIds(
    eventId: string,
    studentIds: string[],
  ): Promise<ShivirRegistration[]> {
    if (studentIds.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(shivir_registrations)
      .where(
        and(
          eq(shivir_registrations.shivir_event_id, eventId),
          inArray(shivir_registrations.student_id, studentIds),
        ),
      );
  }

  /**
   * Bulk register. Existing (event, student) rows are left untouched (the
   * unique index guarantees idempotency); newcomers land with `status='registered'`.
   */
  async bulkRegister(rows: NewShivirRegistration[]): Promise<ShivirRegistration[]> {
    if (rows.length === 0) return [];
    return this.drizzle.db
      .insert(shivir_registrations)
      .values(rows)
      .onConflictDoNothing({
        target: [shivir_registrations.shivir_event_id, shivir_registrations.student_id],
      })
      .returning();
  }

  async listRegistrationsForEvent(eventId: string): Promise<ShivirRegistration[]> {
    return this.drizzle.dbRead
      .select()
      .from(shivir_registrations)
      .where(eq(shivir_registrations.shivir_event_id, eventId))
      .orderBy(desc(shivir_registrations.registered_at));
  }

  // ===========================================================================
  // shivir_volunteers
  // ===========================================================================

  async assignVolunteer(input: NewShivirVolunteer): Promise<ShivirVolunteer> {
    const [row] = await this.drizzle.db.insert(shivir_volunteers).values(input).returning();
    if (!row) throw new Error('[shivirs.assignVolunteer] INSERT returned no row');
    return row;
  }

  async findVolunteer(eventId: string, userId: string): Promise<ShivirVolunteer | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(shivir_volunteers)
      .where(
        and(
          eq(shivir_volunteers.shivir_event_id, eventId),
          eq(shivir_volunteers.user_id, userId),
          isNull(shivir_volunteers.revoked_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listVolunteersForEvent(eventId: string): Promise<ShivirVolunteer[]> {
    return this.drizzle.dbRead
      .select()
      .from(shivir_volunteers)
      .where(
        and(eq(shivir_volunteers.shivir_event_id, eventId), isNull(shivir_volunteers.revoked_at)),
      )
      .orderBy(desc(shivir_volunteers.assigned_at));
  }

  // ===========================================================================
  // shivir_attendance_scans
  // ===========================================================================

  /**
   * Insert a scan row. Idempotency is checked at the service layer via
   * `findScanByClientOpId`; here we just trust the caller and let the unique
   * constraint catch races.
   */
  async insertScan(input: NewShivirAttendanceScan): Promise<ShivirAttendanceScan> {
    const [row] = await this.drizzle.db.insert(shivir_attendance_scans).values(input).returning();
    if (!row) throw new Error('[shivirs.insertScan] INSERT returned no row');
    return row;
  }

  async findScanByClientOpId(clientOpId: string): Promise<ShivirAttendanceScan | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(shivir_attendance_scans)
      .where(eq(shivir_attendance_scans.client_op_id, clientOpId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Latest scan for a (session, student) — used by the in/out state machine
   * to decide whether the next scan is a check_in or check_out.
   */
  async latestScanFor(sessionId: string, studentId: string): Promise<ShivirAttendanceScan | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(shivir_attendance_scans)
      .where(
        and(
          eq(shivir_attendance_scans.shivir_session_id, sessionId),
          eq(shivir_attendance_scans.student_id, studentId),
        ),
      )
      .orderBy(desc(shivir_attendance_scans.scanned_at))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * All scans for a session — used by exports and the live activity feed.
   * Joined with students for human-readable names.
   *
   * We use the Drizzle query builder (rather than raw `sql\`SELECT *\``) so
   * timestamp columns come back as proper `Date` objects rather than strings.
   */
  async listScansForSession(sessionId: string, limit = 200): Promise<ScanLogRow[]> {
    const rows = await this.drizzle.dbRead
      .select({
        scan: shivir_attendance_scans,
        full_name: students.full_name,
        student_code: students.student_code,
      })
      .from(shivir_attendance_scans)
      .innerJoin(students, eq(students.id, shivir_attendance_scans.student_id))
      .where(eq(shivir_attendance_scans.shivir_session_id, sessionId))
      .orderBy(desc(shivir_attendance_scans.scanned_at))
      .limit(limit);
    return rows.map((r) => ({
      scan: r.scan,
      student_full_name: r.full_name,
      student_code: r.student_code,
    }));
  }

  async listScansForEvent(eventId: string, limit = 1000): Promise<ScanLogRow[]> {
    const rows = await this.drizzle.dbRead
      .select({
        scan: shivir_attendance_scans,
        full_name: students.full_name,
        student_code: students.student_code,
      })
      .from(shivir_attendance_scans)
      .innerJoin(students, eq(students.id, shivir_attendance_scans.student_id))
      .where(eq(shivir_attendance_scans.shivir_event_id, eventId))
      .orderBy(desc(shivir_attendance_scans.scanned_at))
      .limit(limit);
    return rows.map((r) => ({
      scan: r.scan,
      student_full_name: r.full_name,
      student_code: r.student_code,
    }));
  }

  /**
   * Compute the four-counter live dashboard payload in a single query.
   *
   *   registered   — count of registrations (status='registered').
   *   currently_in — registered students whose LATEST scan is `check_in`
   *                  (or `present` in present_only mode).
   *   already_out  — registered students whose LATEST scan is `check_out`.
   *   not_arrived  — registered students with no scan at all.
   *
   * Scope: a `session_id` filter narrows currently_in / already_out / not_arrived
   * to that session; `registered` is always event-wide (registrations are
   * event-level, not session-level).
   */
  async liveCounters(
    eventId: string,
    attendanceMode: ShivirAttendanceMode,
    sessionId?: string,
  ): Promise<LiveCounters> {
    const registeredRows = await this.drizzle.dbRead.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c FROM shivir_registrations
       WHERE shivir_event_id = ${eventId} AND status = 'registered'
    `);
    const registered = registeredRows[0]?.c ?? 0;

    // Latest scan kind per (session, student). When sessionId is omitted we
    // collapse across all sessions of the event.
    const sessionFilter = sessionId
      ? sql`AND s.shivir_session_id = ${sessionId}`
      : sql`AND s.shivir_event_id = ${eventId}`;
    const latestRows = await this.drizzle.dbRead.execute<{
      student_id: string;
      scan_kind: ShivirScanKind;
    }>(sql`
      SELECT student_id, scan_kind FROM (
        SELECT
          s.student_id,
          s.scan_kind,
          ROW_NUMBER() OVER (
            PARTITION BY s.student_id
            ORDER BY s.scanned_at DESC
          ) AS rn
        FROM shivir_attendance_scans s
        WHERE s.shivir_event_id = ${eventId}
          ${sessionFilter}
      ) t
      WHERE t.rn = 1
    `);

    let currentlyIn = 0;
    let alreadyOut = 0;
    const scannedStudentIds = new Set<string>();
    for (const r of latestRows) {
      scannedStudentIds.add(r.student_id);
      if (attendanceMode === 'present_only') {
        // present_only: a single `present` scan counts as "in".
        if (r.scan_kind === 'present') currentlyIn += 1;
      } else {
        // in_out: alternation.
        if (r.scan_kind === 'check_in') currentlyIn += 1;
        else if (r.scan_kind === 'check_out') alreadyOut += 1;
      }
    }

    // not_arrived = registered students who haven't appeared in scans.
    // We need to know which student_ids are registered.
    const registeredIdsRows = await this.drizzle.dbRead.execute<{ student_id: string }>(sql`
      SELECT student_id FROM shivir_registrations
       WHERE shivir_event_id = ${eventId} AND status = 'registered'
    `);
    let notArrived = 0;
    for (const r of registeredIdsRows) {
      if (!scannedStudentIds.has(r.student_id)) notArrived += 1;
    }

    return {
      registered,
      currently_in: currentlyIn,
      already_out: alreadyOut,
      not_arrived: notArrived,
    };
  }
}
