/**
 * HomeworkSubmissionsRepository — read/write helpers for
 * `homework_submissions` (SPEC §5.9).
 *
 * State machine: pending → submitted → approved | rejected | late.
 * The `late` boolean is set by the late-homework cron processor when an
 * assignment passes its due_date with a still-pending submission.
 *
 * Punya is wired via `punya_transaction_id` — set after a successful grade
 * on 'approved' or 'starred'.
 */

import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { homework_submissions } from '../schema';

import type { HomeworkSubmission, NewHomeworkSubmission } from '../schema';
import type { HomeworkStatus } from '@jp/shared';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type Tx = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

@Injectable()
export class HomeworkSubmissionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<HomeworkSubmission | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(homework_submissions)
      .where(eq(homework_submissions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByAssignmentAndStudent(
    assignmentId: string,
    studentId: string,
  ): Promise<HomeworkSubmission | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(homework_submissions)
      .where(
        and(
          eq(homework_submissions.assignment_id, assignmentId),
          eq(homework_submissions.student_id, studentId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(input: NewHomeworkSubmission, tx?: Tx): Promise<HomeworkSubmission> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .insert(homework_submissions)
      .values(input)
      .onConflictDoNothing({
        target: [homework_submissions.assignment_id, homework_submissions.student_id],
      })
      .returning();
    if (row) return row;
    // race / replay → re-read
    const existing = await runner
      .select()
      .from(homework_submissions)
      .where(
        and(
          eq(homework_submissions.assignment_id, input.assignment_id),
          eq(homework_submissions.student_id, input.student_id),
        ),
      )
      .limit(1);
    if (!existing[0]) throw new Error('[HomeworkSubmissions.insert] insert raced + re-read empty');
    return existing[0];
  }

  /**
   * Bulk-create a `pending` submission row per student when a shikshak
   * assigns a homework. The state machine reads better when the row exists
   * from the moment of assignment.
   */
  async bulkSeedPending(assignmentId: string, studentIds: string[]): Promise<HomeworkSubmission[]> {
    if (studentIds.length === 0) return [];
    const values: NewHomeworkSubmission[] = studentIds.map((sid) => ({
      assignment_id: assignmentId,
      student_id: sid,
      status: 'pending' as HomeworkStatus,
      late: false,
    }));
    const rows = await this.drizzle.db
      .insert(homework_submissions)
      .values(values)
      .onConflictDoNothing({
        target: [homework_submissions.assignment_id, homework_submissions.student_id],
      })
      .returning();
    return rows;
  }

  async listByAssignment(assignmentId: string): Promise<HomeworkSubmission[]> {
    return this.drizzle.dbRead
      .select()
      .from(homework_submissions)
      .where(eq(homework_submissions.assignment_id, assignmentId))
      .orderBy(desc(homework_submissions.updated_at));
  }

  async listByStudent(
    studentId: string,
    opts: { status?: HomeworkStatus; limit?: number; offset?: number } = {},
  ): Promise<HomeworkSubmission[]> {
    const where = [eq(homework_submissions.student_id, studentId)];
    if (opts.status) where.push(eq(homework_submissions.status, opts.status));
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    return this.drizzle.dbRead
      .select()
      .from(homework_submissions)
      .where(and(...where))
      .orderBy(desc(homework_submissions.updated_at))
      .limit(limit)
      .offset(offset);
  }

  async listByAssignments(assignmentIds: string[]): Promise<HomeworkSubmission[]> {
    if (assignmentIds.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(homework_submissions)
      .where(inArray(homework_submissions.assignment_id, assignmentIds));
  }

  /** Mark all still-pending submissions for an assignment as late. */
  async markLateForAssignment(assignmentId: string): Promise<number> {
    const rows = await this.drizzle.db
      .update(homework_submissions)
      .set({ late: true, status: 'late', updated_at: new Date() })
      .where(
        and(
          eq(homework_submissions.assignment_id, assignmentId),
          eq(homework_submissions.status, 'pending'),
        ),
      )
      .returning();
    return rows.length;
  }

  /** Mark a single submission as submitted (parent acknowledges). */
  async markSubmitted(
    assignmentId: string,
    studentId: string,
    submissionAssetId: string | null,
  ): Promise<HomeworkSubmission | null> {
    const [row] = await this.drizzle.db
      .update(homework_submissions)
      .set({
        // Status stays 'pending' until shikshak grades; we only flip 'late'
        // → 'pending' if the parent acknowledges before the cron fires.
        status: 'pending',
        submission_asset_id: submissionAssetId,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(homework_submissions.assignment_id, assignmentId),
          eq(homework_submissions.student_id, studentId),
          inArray(homework_submissions.status, ['pending', 'late']),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Grade a submission. `status` is the post-grade status: 'approved' for
   * a plain pass, 'starred' for bonus Punya. `punya_transaction_id` is set
   * after the upstream PunyaService.award call succeeds.
   */
  async grade(
    id: string,
    opts: {
      status: 'approved' | 'starred';
      feedback_note: string | null;
      marked_by_user_id: string;
      punya_transaction_id: string;
    },
    tx?: Tx,
  ): Promise<HomeworkSubmission | null> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .update(homework_submissions)
      .set({
        status: opts.status,
        feedback_note: opts.feedback_note,
        marked_by_user_id: opts.marked_by_user_id,
        marked_at: new Date(),
        punya_transaction_id: opts.punya_transaction_id,
        updated_at: new Date(),
      })
      .where(and(eq(homework_submissions.id, id), isNull(homework_submissions.marked_at)))
      .returning();
    return row ?? null;
  }

  async countByAssignment(assignmentId: string): Promise<number> {
    const rows = await this.drizzle.dbRead
      .select({ c: count() })
      .from(homework_submissions)
      .where(eq(homework_submissions.assignment_id, assignmentId));
    return Number(rows[0]?.c ?? 0);
  }
}
