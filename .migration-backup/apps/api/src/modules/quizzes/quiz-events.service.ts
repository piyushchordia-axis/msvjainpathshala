/**
 * QuizEventsService — Step 20 (SPEC §5.14, §6.18).
 *
 * Scheduled quizzes. Lifecycle:
 *   create() (city_admin+) → student (parent / student-view) start() at
 *   start_at..end_at → submit() auto-grades on the fly → Punya awarded
 *   immediately. No external "release results" step — these are individual
 *   quizzes per student, not a class-wide exam.
 *
 * Auto-grade rule:
 *   - For each question, compare the set of selected option indices to
 *     `correct_indices` (sorted comparison). Exact match → correct.
 *   - `score` = number of correct questions × question count fraction; we
 *     surface both `correct_count` and `total_count` to the client.
 *
 * Punya:
 *   - On submit, award `participation_points` with idempotency key
 *     `quiz_event:{event_id}:participation:{student_id}`. Always fires.
 *   - On 100% correct, also award `win_points` with key
 *     `quiz_event:{event_id}:win:{student_id}`.
 */

import { Injectable, Logger } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import {
  QuestionsRepository,
  QuizEventsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditService } from '../audit/audit.service';
import { PunyaService } from '../punya/punya.service';

import { QuestionsService } from './questions.service';

import type {
  CreateQuizEventInput,
  QuizEventDto,
  StartQuizAttemptInput,
  StartQuizAttemptResult,
  SubmitQuizAttemptInput,
  SubmitQuizAttemptResult,
} from './quizzes.types';
import type { QuizEvent } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

@Injectable()
export class QuizEventsService {
  private readonly logger = new Logger(QuizEventsService.name);

  constructor(
    private readonly repo: QuizEventsRepository,
    private readonly questionsRepo: QuestionsRepository,
    private readonly questionsService: QuestionsService,
    private readonly students: StudentsRepository,
    private readonly punya: PunyaService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // Admin — create
  // ===========================================================================

  async create(actor: ScopedActor, input: CreateQuizEventInput): Promise<QuizEventDto> {
    this.assertCanAdmin(actor);

    if (input.scope === 'city') {
      if (!actor.city_id && actor.role === 'city_admin') {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'city_admin scope missing city',
          statusCode: 403,
        });
      }
    }
    if (!input.title_en?.trim() || !input.title_hi?.trim()) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_BILINGUAL_REQUIRED,
        message: 'Both title_en and title_hi are required',
        statusCode: 422,
      });
    }
    const start = new Date(input.start_at);
    const end = new Date(input.end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_DATETIME_FORMAT,
        message: 'end_at must be after start_at',
        statusCode: 422,
      });
    }
    if (input.question_ids.length === 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'At least one question is required',
        statusCode: 422,
      });
    }

    // Verify each question exists + is approved.
    const resolved = await this.questionsService.resolveApproved(input.question_ids);

    const cityId = input.scope === 'national' ? null : (input.city_id ?? actor.city_id ?? null);

    const event = await this.repo.insertEvent({
      scope: input.scope,
      city_id: cityId,
      centre_id: input.centre_id ?? null,
      batch_id: input.batch_id ?? null,
      title_en: input.title_en.trim(),
      title_hi: input.title_hi.trim(),
      start_at: start,
      end_at: end,
      participation_points: input.participation_points ?? 10,
      win_points: input.win_points ?? 30,
      target_age_groups: input.target_age_groups ?? null,
      created_by: actor.user_id,
      updated_by: actor.user_id,
    });

    const links = [];
    for (let i = 0; i < input.question_ids.length; i += 1) {
      const link = await this.repo.insertEventQuestion({
        quiz_event_id: event.id,
        question_id: input.question_ids[i]!,
        order_index: i,
      });
      links.push({ link, question: resolved.find((q) => q.id === link.question_id)! });
    }

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'quiz_event',
        entity_id: event.id,
        after: {
          scope: event.scope,
          city_id: event.city_id,
          title_en: event.title_en,
          questions: links.length,
        },
      })
      .catch(() => undefined);

    return { event, questions: links };
  }

  // ===========================================================================
  // Parent — list + start
  // ===========================================================================

  async listForParent(actor: ScopedActor): Promise<QuizEvent[]> {
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents can list quizzes for their children',
        statusCode: 403,
      });
    }
    if (!actor.city_id) return [];
    const now = new Date();
    return this.repo.listActiveForCity(actor.city_id, now);
  }

  async start(
    actor: ScopedActor,
    eventId: string,
    input: StartQuizAttemptInput,
  ): Promise<StartQuizAttemptResult> {
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents (or student-view) can start a quiz',
        statusCode: 403,
      });
    }
    const event = await this.requireEvent(eventId);
    const now = new Date();
    if (now < event.start_at || now > event.end_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_EVENT_WINDOW_CLOSED,
        message: 'Quiz is not in its window',
        statusCode: 409,
      });
    }
    const student = await this.students.findById(input.student_id);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    if (student.parent_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Student is not yours',
        statusCode: 403,
      });
    }

    // Idempotent — if there's already a submitted attempt, refuse a fresh start.
    const existing = await this.repo.findAttemptByEventAndStudent(eventId, student.id);
    if (existing?.submitted_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_ATTEMPT_ALREADY_SUBMITTED,
        message: 'You have already submitted this quiz',
        statusCode: 409,
      });
    }
    const attempt =
      existing ??
      (await this.repo.insertAttempt({
        quiz_event_id: eventId,
        student_id: student.id,
        started_at: now,
      }));

    const links = await this.repo.listQuestionsForEvent(eventId);
    const allQs = await this.questionsRepo.listByIds(links.map((l) => l.question_id));
    const qById = new Map(allQs.map((q) => [q.id, q]));

    const safeQuestions = links.map((l) => {
      const q = qById.get(l.question_id)!;
      return {
        id: q.id,
        question_en: q.question_en,
        question_hi: q.question_hi,
        // Cast options jsonb to public shape and strip any correct_indices field.
        options: Array.isArray(q.options)
          ? (q.options as Array<{ id: string; text_en: string; text_hi: string }>).map((o) => ({
              id: o.id,
              text_en: o.text_en,
              text_hi: o.text_hi,
            }))
          : [],
      };
    });

    return { attempt, questions: safeQuestions, server_now: now.toISOString() };
  }

  async submit(
    actor: ScopedActor,
    attemptId: string,
    input: SubmitQuizAttemptInput,
  ): Promise<SubmitQuizAttemptResult> {
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents can submit',
        statusCode: 403,
      });
    }
    const attempt = await this.repo.findAttemptById(attemptId);
    if (!attempt) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Quiz attempt not found',
        statusCode: 404,
      });
    }
    if (attempt.submitted_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_ATTEMPT_ALREADY_SUBMITTED,
        message: 'Attempt already submitted',
        statusCode: 409,
      });
    }
    const event = await this.requireEvent(attempt.quiz_event_id);
    const student = await this.students.findById(attempt.student_id);
    if (!student || student.parent_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Attempt is not yours',
        statusCode: 403,
      });
    }
    const now = new Date();
    if (now > event.end_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_EVENT_WINDOW_CLOSED,
        message: 'Quiz window has closed',
        statusCode: 409,
      });
    }

    const links = await this.repo.listQuestionsForEvent(event.id);
    const allQs = await this.questionsRepo.listByIds(links.map((l) => l.question_id));
    const qById = new Map(allQs.map((q) => [q.id, q]));

    let correct = 0;
    for (const ans of input.answers) {
      const q = qById.get(ans.question_id);
      if (!q) continue;
      const expected = (q.correct_indices ?? []).slice().sort((a, b) => a - b);
      const given = ans.selected_indices.slice().sort((a, b) => a - b);
      if (expected.length === given.length && expected.every((v, i) => v === given[i])) {
        correct += 1;
      }
    }
    const total = links.length;
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;

    const updated = await this.repo.updateAttempt(attemptId, {
      submitted_at: now,
      score,
      correct_count: correct,
      total_count: total,
    });

    // Punya — participation always; win only when perfect.
    if (event.participation_points > 0) {
      await this.punya
        .award({
          student_id: student.id,
          feature_key: 'quiz_participation',
          points: event.participation_points,
          reason: `Quiz attempted: ${event.title_en}`,
          awarded_by_user_id: null,
          source_entity_kind: 'quiz_event',
          source_entity_id: event.id,
          idempotency_key: `quiz_event:${event.id}:participation:${student.id}`,
        })
        .catch((err) => this.logger.warn(`quiz participation punya: ${(err as Error).message}`));
    }
    if (correct === total && total > 0 && event.win_points > 0) {
      await this.punya
        .award({
          student_id: student.id,
          feature_key: 'quiz_top_score',
          points: event.win_points,
          reason: `Quiz perfect: ${event.title_en}`,
          awarded_by_user_id: null,
          source_entity_kind: 'quiz_event',
          source_entity_id: event.id,
          idempotency_key: `quiz_event:${event.id}:win:${student.id}`,
        })
        .catch((err) => this.logger.warn(`quiz win punya: ${(err as Error).message}`));
    }

    return {
      attempt: updated!,
      score,
      correct_count: correct,
      total_count: total,
    };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async requireEvent(id: string): Promise<QuizEvent> {
    const e = await this.repo.findEventById(id);
    if (!e) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_NOT_FOUND,
        message: 'Quiz event not found',
        statusCode: 404,
      });
    }
    return e;
  }

  private assertCanAdmin(actor: ScopedActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only city_admin+ can create quiz events',
        statusCode: 403,
      });
    }
  }
}
