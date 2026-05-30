/**
 * QuestionsRepository — write/read helpers for the reusable quiz question
 * bank (SPEC §5.14, §6.18).
 *
 * Houses the `questions` table only — quiz event linking lives in
 * QuizEventsRepository. Step 20 adds two columns:
 *   - `is_ai_generated` boolean
 *   - `ai_review_status` text ('pending_review' | 'approved' | 'rejected')
 *
 * AI-generated rows enter `pending_review` and are filtered out of the
 * quiz_event question picker until a super_admin moves them to `approved`.
 *
 * Also houses `ai_generation_jobs` lifecycle helpers since the questions
 * land in this table when the worker finishes.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { ai_generation_jobs, questions } from '../schema';

import type { AiGenerationJob, NewAiGenerationJob, NewQuestion, Question } from '../schema';

export type AiReviewStatus = 'pending_review' | 'approved' | 'rejected';
export type AiJobStatus = 'queued' | 'running' | 'ready' | 'failed';

@Injectable()
export class QuestionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // ===========================================================================
  // Question bank
  // ===========================================================================

  async insert(input: NewQuestion): Promise<Question> {
    const [row] = await this.drizzle.db.insert(questions).values(input).returning();
    if (!row) throw new Error('[Questions.insert] no row returned');
    return row;
  }

  async findById(id: string): Promise<Question | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(questions)
      .where(eq(questions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByIds(ids: string[]): Promise<Question[]> {
    if (ids.length === 0) return [];
    return this.drizzle.dbRead.select().from(questions).where(inArray(questions.id, ids));
  }

  async update(id: string, patch: Partial<Omit<NewQuestion, 'id'>>): Promise<Question | null> {
    const [row] = await this.drizzle.db
      .update(questions)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(questions.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Approved question-bank rows for the quiz-event picker (SPEC §6.18).
   *
   * Only `ai_review_status='approved'` rows surface — AI rows pending review
   * or rejected are excluded. `cityScopeId`, when set, narrows city-scoped
   * rows to that city (national/state rows always included); leaving it
   * undefined returns every approved row (super/state admin).
   */
  async listForBank(
    opts: { cityScopeId?: string; topic?: string; limit?: number } = {},
  ): Promise<Question[]> {
    const conds: SQL[] = [eq(questions.ai_review_status, 'approved')];
    if (opts.cityScopeId) {
      const scopeCond = or(
        inArray(questions.scope, ['national', 'state']),
        and(eq(questions.scope, 'city'), eq(questions.city_id, opts.cityScopeId)),
      );
      if (scopeCond) conds.push(scopeCond);
    }
    if (opts.topic) conds.push(eq(questions.topic, opts.topic));
    return this.drizzle.dbRead
      .select()
      .from(questions)
      .where(and(...conds))
      .orderBy(desc(questions.created_at))
      .limit(Math.min(Math.max(opts.limit ?? 200, 1), 500));
  }

  /** Pending-review queue (AI-generated, not yet approved/rejected). */
  async listPendingAiReview(limit = 50): Promise<Question[]> {
    return this.drizzle.dbRead
      .select()
      .from(questions)
      .where(
        and(eq(questions.is_ai_generated, true), eq(questions.ai_review_status, 'pending_review')),
      )
      .orderBy(desc(questions.created_at))
      .limit(limit);
  }

  // ===========================================================================
  // AI generation jobs
  // ===========================================================================

  async insertJob(input: NewAiGenerationJob): Promise<AiGenerationJob> {
    const [row] = await this.drizzle.db.insert(ai_generation_jobs).values(input).returning();
    if (!row) throw new Error('[Questions.insertJob] no row returned');
    return row;
  }

  async findJobById(id: string): Promise<AiGenerationJob | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(ai_generation_jobs)
      .where(eq(ai_generation_jobs.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateJob(
    id: string,
    patch: Partial<Omit<NewAiGenerationJob, 'id'>>,
  ): Promise<AiGenerationJob | null> {
    const [row] = await this.drizzle.db
      .update(ai_generation_jobs)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(ai_generation_jobs.id, id))
      .returning();
    return row ?? null;
  }

  /** Helper used by the worker test path — mark a row as ready with ids. */
  async markJobReady(id: string, questionIds: string[]): Promise<AiGenerationJob | null> {
    return this.updateJob(id, {
      status: 'ready',
      result_question_ids: questionIds,
      // We cast away from the date string for parity with insertJob in tests.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  // ===========================================================================
  // Aggregates
  // ===========================================================================

  async countByScope(scope: 'national' | 'state' | 'city', cityId?: string): Promise<number> {
    const where = [eq(questions.scope, scope)];
    if (cityId && scope === 'city') where.push(eq(questions.city_id, cityId));
    const [row] = (await this.drizzle.dbRead.execute(
      sql`SELECT COUNT(*)::int AS c FROM questions WHERE ${and(...where)!}`,
    )) as unknown as Array<{ c: number }>;
    return row?.c ?? 0;
  }
}
