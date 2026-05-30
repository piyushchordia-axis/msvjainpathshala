/**
 * QuizEventsRepository — scheduled quiz_events + quiz_event_questions +
 * quiz_attempts (SPEC §5.14, §6.18).
 *
 * Scheduled quizzes are time-windowed (start_at..end_at) and reuse the
 * question bank via `quiz_event_questions`. Auto-grade happens on submit;
 * Punya is awarded per `participation_points` + `win_points`.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { quiz_attempts, quiz_event_questions, quiz_events } from '../schema';

import type {
  NewQuizAttempt,
  NewQuizEvent,
  NewQuizEventQuestion,
  QuizAttempt,
  QuizEvent,
  QuizEventQuestion,
} from '../schema';

@Injectable()
export class QuizEventsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // ===========================================================================
  // Events
  // ===========================================================================

  async insertEvent(input: NewQuizEvent): Promise<QuizEvent> {
    const [row] = await this.drizzle.db.insert(quiz_events).values(input).returning();
    if (!row) throw new Error('[QuizEvents.insertEvent] no row returned');
    return row;
  }

  async findEventById(id: string): Promise<QuizEvent | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(quiz_events)
      .where(eq(quiz_events.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listForCity(cityId: string): Promise<QuizEvent[]> {
    return this.drizzle.dbRead
      .select()
      .from(quiz_events)
      .where(eq(quiz_events.city_id, cityId))
      .orderBy(desc(quiz_events.start_at));
  }

  /** Quiz events active "now" — within their start..end window. */
  async listActiveForCity(cityId: string, now: Date): Promise<QuizEvent[]> {
    return this.drizzle.dbRead
      .select()
      .from(quiz_events)
      .where(
        and(
          eq(quiz_events.city_id, cityId),
          lte(quiz_events.start_at, now),
          gte(quiz_events.end_at, now),
        ),
      )
      .orderBy(asc(quiz_events.start_at));
  }

  // ===========================================================================
  // Event questions
  // ===========================================================================

  async insertEventQuestion(input: NewQuizEventQuestion): Promise<QuizEventQuestion> {
    const [row] = await this.drizzle.db.insert(quiz_event_questions).values(input).returning();
    if (!row) throw new Error('[QuizEvents.insertEventQuestion] no row returned');
    return row;
  }

  async listQuestionsForEvent(eventId: string): Promise<QuizEventQuestion[]> {
    return this.drizzle.dbRead
      .select()
      .from(quiz_event_questions)
      .where(eq(quiz_event_questions.quiz_event_id, eventId))
      .orderBy(asc(quiz_event_questions.order_index));
  }

  // ===========================================================================
  // Attempts
  // ===========================================================================

  async insertAttempt(input: NewQuizAttempt): Promise<QuizAttempt> {
    const [row] = await this.drizzle.db.insert(quiz_attempts).values(input).returning();
    if (!row) throw new Error('[QuizEvents.insertAttempt] no row returned');
    return row;
  }

  async findAttemptById(id: string): Promise<QuizAttempt | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(quiz_attempts)
      .where(eq(quiz_attempts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findAttemptByEventAndStudent(
    eventId: string,
    studentId: string,
  ): Promise<QuizAttempt | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(quiz_attempts)
      .where(and(eq(quiz_attempts.quiz_event_id, eventId), eq(quiz_attempts.student_id, studentId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateAttempt(
    id: string,
    patch: Partial<Omit<NewQuizAttempt, 'id'>>,
  ): Promise<QuizAttempt | null> {
    const [row] = await this.drizzle.db
      .update(quiz_attempts)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(quiz_attempts.id, id))
      .returning();
    return row ?? null;
  }

  async listAttemptsForEvent(eventId: string): Promise<QuizAttempt[]> {
    return this.drizzle.dbRead
      .select()
      .from(quiz_attempts)
      .where(eq(quiz_attempts.quiz_event_id, eventId))
      .orderBy(desc(quiz_attempts.score));
  }
}
