/**
 * AbsenceNotificationsRepository — parent's advance-absence flag for a child.
 *
 * Behaviours:
 *   - `create` inserts a row (one per child-per-date is allowed; multiple
 *     reasons are not modeled — second submission overwrites via app logic).
 *   - `findUpcomingForBatch` is called by SessionsService when the shikshak
 *     loads the marking screen, so excused students are pre-flagged.
 */

import { Injectable } from '@nestjs/common';
import { and, between, eq, inArray } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { absence_notifications, students } from '../schema';

import type { AbsenceNotification, NewAbsenceNotification } from '../schema';

@Injectable()
export class AbsenceNotificationsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(input: NewAbsenceNotification): Promise<AbsenceNotification> {
    const [row] = await this.drizzle.db.insert(absence_notifications).values(input).returning();
    if (!row) throw new Error('[AbsenceNotifications.create] insert returned no row');
    return row;
  }

  async findForStudentDate(studentId: string, date: string): Promise<AbsenceNotification | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(absence_notifications)
      .where(
        and(
          eq(absence_notifications.student_id, studentId),
          eq(absence_notifications.expected_date, date),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Pre-fill helper for the shikshak marking screen: returns the set of
   * (student_id) that have an absence notice for the session date in this
   * batch.
   */
  async findStudentIdsForBatchDate(batchId: string, date: string): Promise<string[]> {
    const rows = await this.drizzle.dbRead
      .select({ student_id: absence_notifications.student_id })
      .from(absence_notifications)
      .innerJoin(students, eq(students.id, absence_notifications.student_id))
      .where(and(eq(absence_notifications.expected_date, date), eq(students.batch_id, batchId)));
    return rows.map((r) => r.student_id);
  }

  /** Recent notices for a student (parent's own list). */
  async listByStudent(
    studentId: string,
    fromDate: string,
    toDate: string,
  ): Promise<AbsenceNotification[]> {
    return this.drizzle.dbRead
      .select()
      .from(absence_notifications)
      .where(
        and(
          eq(absence_notifications.student_id, studentId),
          between(absence_notifications.expected_date, fromDate, toDate),
        ),
      );
  }

  async findForStudents(studentIds: string[], date: string): Promise<AbsenceNotification[]> {
    if (studentIds.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(absence_notifications)
      .where(
        and(
          inArray(absence_notifications.student_id, studentIds),
          eq(absence_notifications.expected_date, date),
        ),
      );
  }
}
