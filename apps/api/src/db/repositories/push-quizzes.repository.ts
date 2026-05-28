/**
 * PushQuizzesRepository — write/read helpers for push_quizzes,
 * push_quiz_questions and push_quiz_attempts (SPEC §5.14, §6.18, §9.4).
 *
 * Push quizzes are shikshak-initiated, time-windowed (started_at..expires_at),
 * and broadcast via Socket.IO on `/push-quizzes/:quizId`. Questions are
 * advanced one at a time by the shikshak — the service tracks the "currently
 * active" question by `order_index` and writes per-question answers as a JSONB
 * column on push_quiz_attempts (one row per student per quiz).
 *
 * push_quiz_attempts answer shape (JSONB):
 *   {
 *     [question_id]: {
 *       selected_option_index: number,
 *       submitted_at: ISO string,
 *       is_correct: boolean
 *     }
 *   }
 */

import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { push_quiz_attempts, push_quiz_questions, push_quizzes } from '../schema';

import type {
  NewPushQuiz,
  NewPushQuizAttempt,
  NewPushQuizQuestion,
  PushQuiz,
  PushQuizAttempt,
  PushQuizQuestion,
} from '../schema';

/** Shape of the per-question answer recorded inside answers JSONB. */
export interface PushQuizAnswerRecord {
  selected_option_index: number;
  submitted_at: string;
  is_correct: boolean;
}

@Injectable()
export class PushQuizzesRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // ===========================================================================
  // push_quizzes
  // ===========================================================================

  async insert(input: NewPushQuiz): Promise<PushQuiz> {
    const [row] = await this.drizzle.db.insert(push_quizzes).values(input).returning();
    if (!row) throw new Error('[PushQuizzes.insert] no row returned');
    return row;
  }

  async findById(id: string): Promise<PushQuiz | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(push_quizzes)
      .where(eq(push_quizzes.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async update(id: string, patch: Partial<Omit<NewPushQuiz, 'id'>>): Promise<PushQuiz | null> {
    const [row] = await this.drizzle.db
      .update(push_quizzes)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(push_quizzes.id, id))
      .returning();
    return row ?? null;
  }

  async listForBatch(batchId: string, limit = 20): Promise<PushQuiz[]> {
    return this.drizzle.dbRead
      .select()
      .from(push_quizzes)
      .where(eq(push_quizzes.batch_id, batchId))
      .orderBy(desc(push_quizzes.started_at))
      .limit(limit);
  }

  // ===========================================================================
  // push_quiz_questions
  // ===========================================================================

  async insertQuestion(input: NewPushQuizQuestion): Promise<PushQuizQuestion> {
    const [row] = await this.drizzle.db.insert(push_quiz_questions).values(input).returning();
    if (!row) throw new Error('[PushQuizzes.insertQuestion] no row returned');
    return row;
  }

  async listQuestions(pushQuizId: string): Promise<PushQuizQuestion[]> {
    return this.drizzle.dbRead
      .select()
      .from(push_quiz_questions)
      .where(eq(push_quiz_questions.push_quiz_id, pushQuizId))
      .orderBy(asc(push_quiz_questions.order_index));
  }

  async findQuestionById(id: string): Promise<PushQuizQuestion | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(push_quiz_questions)
      .where(eq(push_quiz_questions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  // ===========================================================================
  // push_quiz_attempts (one row per student per push quiz)
  // ===========================================================================

  /**
   * Insert the attempt row OR no-op if it already exists. Returns the row.
   * (Unique index on (push_quiz_id, student_id) — migration 0015.)
   */
  async ensureAttempt(input: NewPushQuizAttempt): Promise<PushQuizAttempt> {
    const [row] = await this.drizzle.db
      .insert(push_quiz_attempts)
      .values(input)
      .onConflictDoUpdate({
        target: [push_quiz_attempts.push_quiz_id, push_quiz_attempts.student_id],
        set: { updated_at: new Date() },
      })
      .returning();
    if (!row) throw new Error('[PushQuizzes.ensureAttempt] no row returned');
    return row;
  }

  async findAttempt(pushQuizId: string, studentId: string): Promise<PushQuizAttempt | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(push_quiz_attempts)
      .where(
        and(
          eq(push_quiz_attempts.push_quiz_id, pushQuizId),
          eq(push_quiz_attempts.student_id, studentId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listAttempts(pushQuizId: string): Promise<PushQuizAttempt[]> {
    return this.drizzle.dbRead
      .select()
      .from(push_quiz_attempts)
      .where(eq(push_quiz_attempts.push_quiz_id, pushQuizId))
      .orderBy(desc(push_quiz_attempts.score));
  }

  /**
   * Merge an answer record into the attempt's JSONB column.
   *
   * We do this client-side (read-modify-write) rather than JSONB ||
   * concatenation so the shape can stay typed and so duplicate
   * (re-)answers for the same question_id overwrite the previous one.
   */
  async upsertAttemptAnswer(
    pushQuizId: string,
    studentId: string,
    questionId: string,
    answer: PushQuizAnswerRecord,
  ): Promise<PushQuizAttempt> {
    // Ensure row exists first (idempotent insert).
    await this.ensureAttempt({
      push_quiz_id: pushQuizId,
      student_id: studentId,
      answers: {},
    });
    const existing = await this.findAttempt(pushQuizId, studentId);
    const answers = (existing?.answers as Record<string, PushQuizAnswerRecord> | null) ?? {};
    answers[questionId] = answer;
    const score = Object.values(answers).filter((a) => a.is_correct).length;
    const updated = await this.drizzle.db
      .update(push_quiz_attempts)
      .set({ answers, score, updated_at: new Date() })
      .where(
        and(
          eq(push_quiz_attempts.push_quiz_id, pushQuizId),
          eq(push_quiz_attempts.student_id, studentId),
        ),
      )
      .returning();
    if (!updated[0]) throw new Error('[PushQuizzes.upsertAttemptAnswer] no row returned');
    return updated[0];
  }

  /** Bulk-update at end of push quiz: stamp submitted_at on every row. */
  async stampSubmittedAt(pushQuizId: string, at: Date): Promise<number> {
    const rows = await this.drizzle.db
      .update(push_quiz_attempts)
      .set({ submitted_at: at, updated_at: new Date() })
      .where(eq(push_quiz_attempts.push_quiz_id, pushQuizId))
      .returning({ id: push_quiz_attempts.id });
    return rows.length;
  }
}
