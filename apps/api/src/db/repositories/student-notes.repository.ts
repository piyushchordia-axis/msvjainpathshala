/**
 * StudentNotesRepository — shikshak-only notes about a student. SPEC §5.20.
 *
 * Two production callers in Step 13:
 *   - The consecutive-absence cron inserts an alert row when 3 sessions in
 *     a row are marked absent (Q: parent + sanchalak + city_admin notify).
 *   - (Future) Shikshak progress-report flow inserts manual notes.
 *
 * Notes are NEVER shown to parent/student — only to shikshak+/sanchalak+.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, like } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { student_notes } from '../schema';

import type { NewStudentNote, StudentNote } from '../schema';

@Injectable()
export class StudentNotesRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(input: NewStudentNote): Promise<StudentNote> {
    const [row] = await this.drizzle.db.insert(student_notes).values(input).returning();
    if (!row) throw new Error('[StudentNotes.insert] insert returned no row');
    return row;
  }

  async listForStudent(studentId: string, limit = 50): Promise<StudentNote[]> {
    return this.drizzle.dbRead
      .select()
      .from(student_notes)
      .where(and(eq(student_notes.student_id, studentId), isNull(student_notes.deleted_at)))
      .orderBy(desc(student_notes.created_at))
      .limit(limit);
  }

  /**
   * Has the consecutive-absence cron already flagged this student in the
   * last N days? Used to debounce re-flagging.
   */
  async hasRecentAlert(studentId: string, needlePrefix: string, sinceDate: Date): Promise<boolean> {
    const rows = await this.drizzle.dbRead
      .select({ id: student_notes.id })
      .from(student_notes)
      .where(
        and(
          eq(student_notes.student_id, studentId),
          like(student_notes.note, `${needlePrefix}%`),
          gte(student_notes.created_at, sinceDate),
          isNull(student_notes.deleted_at),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
