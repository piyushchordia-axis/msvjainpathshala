/**
 * ExamsRepository — write/read helpers for online_exams, exam_questions,
 * exam_question_options, exam_attempts and exam_answers (SPEC §5.14, §6.17).
 *
 * Five tables in one repo because the exam service consumes all of them
 * together (creating an exam writes questions+options atomically; submit
 * needs attempt+answers+options for auto-grading).
 */

import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import {
  exam_answers,
  exam_attempts,
  exam_question_options,
  exam_questions,
  online_exams,
} from '../schema';

import type {
  ExamAnswer,
  ExamAttempt,
  ExamQuestion,
  ExamQuestionOption,
  NewExamAnswer,
  NewExamAttempt,
  NewExamQuestion,
  NewExamQuestionOption,
  NewOnlineExam,
  OnlineExam,
} from '../schema';

@Injectable()
export class ExamsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // ===========================================================================
  // Online exams
  // ===========================================================================

  async insertExam(input: NewOnlineExam): Promise<OnlineExam> {
    const [row] = await this.drizzle.db.insert(online_exams).values(input).returning();
    if (!row) throw new Error('[Exams.insertExam] no row returned');
    return row;
  }

  async findExamById(id: string): Promise<OnlineExam | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(online_exams)
      .where(eq(online_exams.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateExam(
    id: string,
    patch: Partial<Omit<NewOnlineExam, 'id'>>,
  ): Promise<OnlineExam | null> {
    const [row] = await this.drizzle.db
      .update(online_exams)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(online_exams.id, id))
      .returning();
    return row ?? null;
  }

  async listForCity(
    cityId: string,
    opts: { now?: Date; inWindow?: boolean } = {},
  ): Promise<OnlineExam[]> {
    const where = [eq(online_exams.city_id, cityId)];
    if (opts.inWindow && opts.now) {
      where.push(lte(online_exams.window_start, opts.now));
      where.push(gte(online_exams.window_end, opts.now));
    }
    return this.drizzle.dbRead
      .select()
      .from(online_exams)
      .where(and(...where))
      .orderBy(desc(online_exams.window_start));
  }

  // ===========================================================================
  // Exam questions + options
  // ===========================================================================

  async insertQuestion(input: NewExamQuestion): Promise<ExamQuestion> {
    const [row] = await this.drizzle.db.insert(exam_questions).values(input).returning();
    if (!row) throw new Error('[Exams.insertQuestion] no row returned');
    return row;
  }

  async insertOption(input: NewExamQuestionOption): Promise<ExamQuestionOption> {
    const [row] = await this.drizzle.db.insert(exam_question_options).values(input).returning();
    if (!row) throw new Error('[Exams.insertOption] no row returned');
    return row;
  }

  async listQuestions(examId: string): Promise<ExamQuestion[]> {
    return this.drizzle.dbRead
      .select()
      .from(exam_questions)
      .where(eq(exam_questions.exam_id, examId))
      .orderBy(asc(exam_questions.order_index));
  }

  async listOptionsForQuestions(questionIds: string[]): Promise<ExamQuestionOption[]> {
    if (questionIds.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(exam_question_options)
      .where(inArray(exam_question_options.question_id, questionIds))
      .orderBy(asc(exam_question_options.order_index));
  }

  async findQuestionById(id: string): Promise<ExamQuestion | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(exam_questions)
      .where(eq(exam_questions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  // ===========================================================================
  // Attempts
  // ===========================================================================

  async insertAttempt(input: NewExamAttempt): Promise<ExamAttempt> {
    const [row] = await this.drizzle.db.insert(exam_attempts).values(input).returning();
    if (!row) throw new Error('[Exams.insertAttempt] no row returned');
    return row;
  }

  async findAttemptById(id: string): Promise<ExamAttempt | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(exam_attempts)
      .where(eq(exam_attempts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findAttemptsByStudent(examId: string, studentId: string): Promise<ExamAttempt[]> {
    return this.drizzle.dbRead
      .select()
      .from(exam_attempts)
      .where(and(eq(exam_attempts.exam_id, examId), eq(exam_attempts.student_id, studentId)))
      .orderBy(desc(exam_attempts.started_at));
  }

  async updateAttempt(
    id: string,
    patch: Partial<Omit<NewExamAttempt, 'id'>>,
  ): Promise<ExamAttempt | null> {
    const [row] = await this.drizzle.db
      .update(exam_attempts)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(exam_attempts.id, id))
      .returning();
    return row ?? null;
  }

  async listAttemptsForExam(examId: string): Promise<ExamAttempt[]> {
    return this.drizzle.dbRead
      .select()
      .from(exam_attempts)
      .where(eq(exam_attempts.exam_id, examId))
      .orderBy(desc(exam_attempts.score));
  }

  // ===========================================================================
  // Answers
  // ===========================================================================

  /**
   * Upsert an autosaved answer. The unique index
   * `idx_exam_answers_attempt_question_unique` (migration 0014) makes the
   * (attempt_id, question_id) tuple the upsert target.
   */
  async upsertAnswer(input: NewExamAnswer): Promise<ExamAnswer> {
    const [row] = await this.drizzle.db
      .insert(exam_answers)
      .values(input)
      .onConflictDoUpdate({
        target: [exam_answers.attempt_id, exam_answers.question_id],
        set: {
          selected_option_ids: input.selected_option_ids ?? null,
          short_text_answer: input.short_text_answer ?? null,
          updated_at: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('[Exams.upsertAnswer] no row returned');
    return row;
  }

  async listAnswers(attemptId: string): Promise<ExamAnswer[]> {
    return this.drizzle.dbRead
      .select()
      .from(exam_answers)
      .where(eq(exam_answers.attempt_id, attemptId));
  }

  async updateAnswer(
    id: string,
    patch: Partial<Omit<NewExamAnswer, 'id'>>,
  ): Promise<ExamAnswer | null> {
    const [row] = await this.drizzle.db
      .update(exam_answers)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(exam_answers.id, id))
      .returning();
    return row ?? null;
  }

  async findAnswerById(id: string): Promise<ExamAnswer | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(exam_answers)
      .where(eq(exam_answers.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}
