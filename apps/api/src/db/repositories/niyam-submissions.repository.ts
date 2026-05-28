/**
 * NiyamSubmissionsRepository — write/read helpers for `niyam_submissions`
 * (SPEC §5.8). Submissions auto-approve at insert (Q5); rejections write a
 * partial update in the SAME row, never a new one.
 *
 * Mutators accept an optional `tx` so the calling service can keep the
 * insert in the same transaction as the Punya award + gallery insert (see
 * `NiyamsService.submit()`).
 */

import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { niyam_submissions, niyams } from '../schema';

import type { NewNiyamSubmission, NiyamSubmission, Niyam } from '../schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type Tx = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

export interface ListAdminSubmissions {
  city_id?: string;
  centre_ids?: string[];
  batch_ids?: string[];
  niyam_id?: string;
  /** When true include rejected rows; default is "all". */
  only_approved?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class NiyamSubmissionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string, tx?: Tx): Promise<NiyamSubmission | null> {
    const runner = (tx ?? this.drizzle.dbRead) as Tx;
    const rows = await runner
      .select()
      .from(niyam_submissions)
      .where(eq(niyam_submissions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Pair the submission with its parent niyam in one query — admin
   * tables need both.
   */
  async findWithNiyamById(
    id: string,
  ): Promise<{ submission: NiyamSubmission; niyam: Niyam } | null> {
    const rows = await this.drizzle.dbRead
      .select({
        submission: niyam_submissions,
        niyam: niyams,
      })
      .from(niyam_submissions)
      .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
      .where(eq(niyam_submissions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(input: NewNiyamSubmission, tx?: Tx): Promise<NiyamSubmission> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner.insert(niyam_submissions).values(input).returning();
    if (!row) throw new Error('[NiyamSubmissions.insert] no row returned');
    return row;
  }

  /**
   * Today's submission for (student, niyam) if any — used to de-dup
   * daily niyams.
   */
  async findForStudentNiyamDate(
    studentId: string,
    niyamId: string,
    submission_date: string,
  ): Promise<NiyamSubmission | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(niyam_submissions)
      .where(
        and(
          eq(niyam_submissions.student_id, studentId),
          eq(niyam_submissions.niyam_id, niyamId),
          eq(niyam_submissions.submission_date, submission_date),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Latest submissions for a student — used by the parent's "recent" feed.
   */
  async listByStudent(studentId: string, limit = 20): Promise<NiyamSubmission[]> {
    return this.drizzle.dbRead
      .select()
      .from(niyam_submissions)
      .where(eq(niyam_submissions.student_id, studentId))
      .orderBy(desc(niyam_submissions.submitted_at))
      .limit(Math.min(limit, 100));
  }

  /**
   * Ordered ascending by `submission_date` so the streak processor can
   * walk forward in time.
   */
  async listApprovedAscByStudentNiyam(
    studentId: string,
    niyamId: string,
  ): Promise<NiyamSubmission[]> {
    return this.drizzle.dbRead
      .select()
      .from(niyam_submissions)
      .where(
        and(
          eq(niyam_submissions.student_id, studentId),
          eq(niyam_submissions.niyam_id, niyamId),
          eq(niyam_submissions.status, 'auto_approved'),
        ),
      )
      .orderBy(asc(niyam_submissions.submission_date));
  }

  async listForAdmin(filters: ListAdminSubmissions): Promise<NiyamSubmission[]> {
    const where = [];
    if (filters.niyam_id) where.push(eq(niyam_submissions.niyam_id, filters.niyam_id));
    if (filters.only_approved) where.push(eq(niyam_submissions.status, 'auto_approved'));

    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;
    return this.drizzle.dbRead
      .select()
      .from(niyam_submissions)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(niyam_submissions.submitted_at))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Mark a submission as rejected (Q5). Returns the updated row; callers
   * must do the 30-day window check + Punya reversal upstream.
   */
  async markRejected(
    id: string,
    opts: {
      rejected_by_user_id: string;
      rejection_reason: string;
      reversal_transaction_id: string;
    },
    tx?: Tx,
  ): Promise<NiyamSubmission | null> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .update(niyam_submissions)
      .set({
        status: 'rejected',
        rejected_at: new Date(),
        rejected_by_user_id: opts.rejected_by_user_id,
        rejection_reason: opts.rejection_reason,
        reversal_transaction_id: opts.reversal_transaction_id,
        updated_at: new Date(),
      })
      .where(and(eq(niyam_submissions.id, id), isNull(niyam_submissions.rejected_at)))
      .returning();
    return row ?? null;
  }

  /**
   * Pluck the approved submissions for (student, niyam) that landed on or
   * before a cut-off — used by the streak processor when computing the
   * longest streak as of a date in the past.
   */
  async approvedDatesByStudentNiyamUpTo(
    studentId: string,
    niyamId: string,
    upTo: string,
  ): Promise<string[]> {
    const rows = await this.drizzle.dbRead
      .select({ submission_date: niyam_submissions.submission_date })
      .from(niyam_submissions)
      .where(
        and(
          eq(niyam_submissions.student_id, studentId),
          eq(niyam_submissions.niyam_id, niyamId),
          eq(niyam_submissions.status, 'auto_approved'),
          gte(niyam_submissions.submission_date, '1970-01-01'),
          sql`${niyam_submissions.submission_date} <= ${upTo}::date`,
        ),
      )
      .orderBy(asc(niyam_submissions.submission_date));
    return rows.map((r) => r.submission_date);
  }

  /**
   * Count approved submissions per student for a list of niyams — feeds
   * the admin grid stat rows.
   */
  async countByNiyamIds(niyamIds: string[]): Promise<Map<string, number>> {
    if (niyamIds.length === 0) return new Map();
    const rows = await this.drizzle.dbRead
      .select({
        niyam_id: niyam_submissions.niyam_id,
        c: count(),
      })
      .from(niyam_submissions)
      .where(
        and(
          inArray(niyam_submissions.niyam_id, niyamIds),
          eq(niyam_submissions.status, 'auto_approved'),
        ),
      )
      .groupBy(niyam_submissions.niyam_id);
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.niyam_id, Number(r.c));
    return map;
  }
}
