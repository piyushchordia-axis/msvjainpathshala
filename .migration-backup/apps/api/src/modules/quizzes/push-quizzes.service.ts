/**
 * PushQuizzesService — Step 20 (SPEC §5.14, §6.18, §9.4).
 *
 * Real-time class quiz lifecycle:
 *
 *   shikshak POST /v1/shikshak/push-quizzes        → create() — questions are
 *     authored inline (not from the bank), expires_at is computed from now()
 *     + expires_in_seconds. quiz row inserted; no Socket.IO emit yet (the
 *     quiz is "drafted" — `started_at` set but no active question).
 *
 *   shikshak POST /v1/quizzes/push/:id/start       → start() — emit `quiz.started`
 *     on `/push-quizzes/:id` with total question count + window.
 *
 *   shikshak POST /v1/quizzes/push/:id/next-question
 *                                                  → nextQuestion() — increment
 *     `active_question_index` (we store it as a redis key tied to the quiz id
 *     since the schema doesn't carry a column). Emit `quiz.question_next` with
 *     the question + options (server strips `correct_indices` first).
 *
 *   student POST /v1/push-quizzes/:id/submit       → submitAnswer() — only the
 *     CURRENTLY-ACTIVE question is acceptable; otherwise ERR_QUIZ_QUESTION_NOT_ACTIVE.
 *     Validates the per-question time window
 *     `(active_started_at .. active_started_at + PUSH_QUIZ_QUESTION_WINDOW_MS)`,
 *     UPSERTS the answer into `push_quiz_attempts.answers` JSONB.
 *     Emits `quiz.answer_received` with aggregated counts.
 *
 *   shikshak POST /v1/quizzes/push/:id/end         → end() — stamps
 *     submitted_at on every attempt, awards `push_quiz_completion` Punya for
 *     each student that answered ≥ 1 question correctly, emits `quiz.ended`
 *     with the leaderboard.
 *
 * Active-question state lives in Redis (auth keyspace, namespaced):
 *     pq:active:{quiz_id} → JSON { question_id, question_index, started_at_ms }
 * This avoids a schema migration just for a transient counter — the source of
 * truth for "what's the live question right now" is wallclock + Redis.
 */

import { Injectable, Logger } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import {
  type PushQuizAnswerRecord,
  PushQuizzesRepository,
  StudentsRepository,
} from '../../db/repositories';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { NAMESPACES } from '../../realtime/realtime.types';
import { AuditService } from '../audit/audit.service';
import { PunyaService } from '../punya/punya.service';

import {
  PUSH_QUIZ_DEFAULT_COMPLETION_POINTS,
  PUSH_QUIZ_DEFAULT_EXPIRES_SECONDS,
  PUSH_QUIZ_QUESTION_WINDOW_MS,
  type CreatePushQuizInput,
  type EndPushQuizResult,
  type NextQuestionResult,
  type PushQuizLeaderboardEntry,
  type PushQuizPublicQuestion,
  type StartPushQuizResult,
  type SubmitPushAnswerInput,
  type SubmitPushAnswerResult,
} from './quizzes.types';

import type { PushQuiz, PushQuizQuestion, Student } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

interface ActiveQuestionState {
  question_id: string;
  question_index: number;
  started_at_ms: number;
}

@Injectable()
export class PushQuizzesService {
  private readonly logger = new Logger(PushQuizzesService.name);

  constructor(
    private readonly repo: PushQuizzesRepository,
    private readonly students: StudentsRepository,
    private readonly punya: PunyaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly redis: RedisService,
  ) {}

  // ===========================================================================
  // shikshak — create
  // ===========================================================================

  async create(actor: ScopedActor, input: CreatePushQuizInput): Promise<PushQuiz> {
    this.assertCanInitiate(actor);
    if (!input.batch_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'batch_id is required',
        statusCode: 422,
      });
    }
    if (!input.questions?.length || input.questions.length > 20) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'Provide between 1 and 20 questions',
        statusCode: 422,
      });
    }
    if (actor.role === 'shikshak' && !(actor.batch_ids ?? []).includes(input.batch_id)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Batch is not yours',
        statusCode: 403,
      });
    }

    const now = new Date();
    const expiresInS = input.expires_in_seconds ?? PUSH_QUIZ_DEFAULT_EXPIRES_SECONDS;
    const expiresAt = new Date(now.getTime() + expiresInS * 1000);

    const quiz = await this.repo.insert({
      batch_id: input.batch_id,
      shikshak_user_id: actor.user_id,
      started_at: now,
      expires_at: expiresAt,
      completion_points: input.completion_points ?? PUSH_QUIZ_DEFAULT_COMPLETION_POINTS,
    });

    for (let i = 0; i < input.questions.length; i += 1) {
      const q = input.questions[i]!;
      if (!q.question_en?.trim() || !q.question_hi?.trim()) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_BILINGUAL_REQUIRED,
          message: 'Both question_en and question_hi are required',
          statusCode: 422,
        });
      }
      if (q.options.length < 2 || q.options.length > 6) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_FAILED,
          message: 'Each question must have 2..6 options',
          statusCode: 422,
        });
      }
      if (
        q.correct_indices.length === 0 ||
        q.correct_indices.some((ix) => ix < 0 || ix >= q.options.length)
      ) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_FAILED,
          message: 'correct_indices must reference existing options',
          statusCode: 422,
        });
      }
      await this.repo.insertQuestion({
        push_quiz_id: quiz.id,
        question_en: q.question_en.trim(),
        question_hi: q.question_hi.trim(),
        options: q.options,
        correct_indices: q.correct_indices,
        order_index: i,
      });
    }

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'push_quiz',
        entity_id: quiz.id,
        after: {
          batch_id: quiz.batch_id,
          expires_at: quiz.expires_at,
          questions: input.questions.length,
        },
      })
      .catch(() => undefined);

    return quiz;
  }

  // ===========================================================================
  // shikshak — start (broadcast quiz.started)
  // ===========================================================================

  async start(actor: ScopedActor, quizId: string): Promise<StartPushQuizResult> {
    this.assertCanInitiate(actor);
    const quiz = await this.requireQuiz(quizId);
    this.assertCanShikshakOperate(actor, quiz);
    const questions = await this.repo.listQuestions(quizId);
    if (questions.length === 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'Push quiz has no questions',
        statusCode: 422,
      });
    }
    const now = new Date();
    if (now > quiz.expires_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_NOT_ACTIVE,
        message: 'Push quiz has already expired',
        statusCode: 409,
      });
    }

    // Reset any prior active-question state.
    await this.redis.cacheClient.del(this.activeKey(quizId)).catch(() => undefined);

    this.realtime.emit(`${NAMESPACES.PUSH_QUIZZES}/${quiz.id}`, 'quiz.started', {
      quiz_id: quiz.id,
      batch_id: quiz.batch_id,
      total_questions: questions.length,
      started_at: quiz.started_at.toISOString(),
      expires_at: quiz.expires_at.toISOString(),
    });

    return { quiz, total_questions: questions.length, active_question: null };
  }

  // ===========================================================================
  // shikshak — next question (broadcast quiz.question_next)
  // ===========================================================================

  async nextQuestion(actor: ScopedActor, quizId: string): Promise<NextQuestionResult> {
    this.assertCanInitiate(actor);
    const quiz = await this.requireQuiz(quizId);
    this.assertCanShikshakOperate(actor, quiz);
    const now = new Date();
    if (now > quiz.expires_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_NOT_ACTIVE,
        message: 'Push quiz has expired',
        statusCode: 409,
      });
    }
    const questions = await this.repo.listQuestions(quizId);
    if (questions.length === 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'Push quiz has no questions',
        statusCode: 422,
      });
    }
    const active = await this.readActive(quizId);
    const nextIndex = active === null ? 0 : active.question_index + 1;
    if (nextIndex >= questions.length) {
      throw new AppError({
        code: ERROR_CODES.ERR_CONFLICT,
        message: 'No more questions — call /end to finalise',
        statusCode: 409,
      });
    }
    const question = questions[nextIndex]!;
    const startedAtMs = Date.now();
    await this.writeActive(quizId, {
      question_id: question.id,
      question_index: nextIndex,
      started_at_ms: startedAtMs,
    });
    const pub = this.toPublicQuestion(question, startedAtMs);
    this.realtime.emit(`${NAMESPACES.PUSH_QUIZZES}/${quiz.id}`, 'quiz.question_next', {
      quiz_id: quiz.id,
      question: pub,
      question_number: nextIndex + 1,
      total_questions: questions.length,
    });
    return {
      quiz,
      question: pub,
      question_number: nextIndex + 1,
      total_questions: questions.length,
    };
  }

  // ===========================================================================
  // student — submit answer
  // ===========================================================================

  async submitAnswer(
    actor: ScopedActor,
    quizId: string,
    studentId: string,
    input: SubmitPushAnswerInput,
  ): Promise<SubmitPushAnswerResult> {
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents (or student-view) can submit push-quiz answers',
        statusCode: 403,
      });
    }
    const quiz = await this.requireQuiz(quizId);
    const now = new Date();
    if (now > quiz.expires_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_NOT_ACTIVE,
        message: 'Push quiz has expired',
        statusCode: 409,
      });
    }
    const student = await this.requireStudent(studentId);
    if (student.parent_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Student is not yours',
        statusCode: 403,
      });
    }
    if (student.batch_id !== quiz.batch_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_STUDENT_NOT_IN_BATCH,
        message: 'Student is not in the quiz batch',
        statusCode: 403,
      });
    }
    const active = await this.readActive(quizId);
    if (!active) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_NOT_STARTED,
        message: 'No question is currently active',
        statusCode: 409,
      });
    }
    if (active.question_id !== input.question_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_QUESTION_NOT_ACTIVE,
        message: 'That question is no longer the active one',
        statusCode: 409,
      });
    }
    // Per-question time window.
    if (Date.now() - active.started_at_ms > PUSH_QUIZ_QUESTION_WINDOW_MS) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_TIME_WINDOW_EXPIRED,
        message: 'Time is up for this question',
        statusCode: 409,
      });
    }
    const question = await this.repo.findQuestionById(input.question_id);
    if (!question || question.push_quiz_id !== quizId) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_QUESTION_NOT_FOUND,
        message: 'Question is not part of this quiz',
        statusCode: 404,
      });
    }
    const correct = (question.correct_indices ?? []).includes(input.selected_option_index);
    const record: PushQuizAnswerRecord = {
      selected_option_index: input.selected_option_index,
      submitted_at: new Date().toISOString(),
      is_correct: correct,
    };
    const attempt = await this.repo.upsertAttemptAnswer(quizId, student.id, question.id, record);

    // Emit a lightweight aggregate so the shikshak sees the live counts.
    await this.emitAggregatedAnswerCounts(quizId, question.id, question.options as Array<unknown>);

    return { attempt, is_correct: correct };
  }

  // ===========================================================================
  // shikshak — end (broadcast quiz.ended + Punya)
  // ===========================================================================

  async end(actor: ScopedActor, quizId: string): Promise<EndPushQuizResult> {
    this.assertCanInitiate(actor);
    const quiz = await this.requireQuiz(quizId);
    this.assertCanShikshakOperate(actor, quiz);
    if (quiz.expires_at.getTime() <= 0) {
      // Defensive — should not happen because we always set it.
    }
    const now = new Date();
    // Idempotent end — `expires_at` can already be in the past; we still want
    // to allow the explicit `end` action. We treat double-end as a 409 by
    // checking whether any attempt rows are already submitted_at-stamped.
    const existingAttempts = await this.repo.listAttempts(quizId);
    const anyStamped = existingAttempts.some((a) => a.submitted_at !== null);
    if (anyStamped) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_ALREADY_ENDED,
        message: 'Push quiz has already been ended',
        statusCode: 409,
      });
    }

    // Stamp submitted_at on all attempts.
    await this.repo.stampSubmittedAt(quizId, now);
    // Update expires_at to "now" so the live-active-question logic stops
    // accepting answers if the shikshak ends early.
    await this.repo.update(quizId, { expires_at: now });
    await this.redis.cacheClient.del(this.activeKey(quizId)).catch(() => undefined);

    // Recompute attempts after stamp.
    const finalAttempts = await this.repo.listAttempts(quizId);
    const questions = await this.repo.listQuestions(quizId);
    const totalQuestions = questions.length;

    // Award Punya per attempt with ≥ 1 correct answer.
    let punyaAwards = 0;
    for (const a of finalAttempts) {
      const correctCount = a.score ?? 0;
      if (correctCount <= 0) continue;
      if (quiz.completion_points <= 0) continue;
      await this.punya
        .award({
          student_id: a.student_id,
          feature_key: 'push_quiz_completion',
          points: quiz.completion_points,
          reason: `Push quiz completed (${correctCount}/${totalQuestions})`,
          awarded_by_user_id: actor.user_id,
          source_entity_kind: 'push_quiz',
          source_entity_id: quiz.id,
          idempotency_key: `push_quiz:${quiz.id}:completion:${a.student_id}`,
        })
        .then(() => {
          punyaAwards += 1;
        })
        .catch((err) => this.logger.warn(`push_quiz completion punya: ${(err as Error).message}`));
    }

    // Build leaderboard sorted by score DESC, submitted_at ASC.
    const leaderboard: PushQuizLeaderboardEntry[] = [];
    const sorted = finalAttempts.slice().sort((a, b) => {
      const sa = a.score ?? 0;
      const sb = b.score ?? 0;
      if (sa !== sb) return sb - sa;
      return (a.submitted_at?.getTime() ?? 0) - (b.submitted_at?.getTime() ?? 0);
    });
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]!;
      const s = await this.students.findById(a.student_id);
      if (!s) continue;
      const correct = a.score ?? 0;
      leaderboard.push({
        student_id: s.id,
        full_name: s.full_name,
        score: correct,
        rank: i + 1,
        correct_count: correct,
        total_count: totalQuestions,
      });
    }

    this.realtime.emit(`${NAMESPACES.PUSH_QUIZZES}/${quiz.id}`, 'quiz.ended', {
      quiz_id: quiz.id,
      participants: finalAttempts.length,
      leaderboard,
      ended_at: now.toISOString(),
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'update',
        entity_kind: 'push_quiz',
        entity_id: quiz.id,
        after: { ended: true, participants: finalAttempts.length },
      })
      .catch(() => undefined);

    return {
      quiz: { ...quiz, expires_at: now },
      participants: finalAttempts.length,
      punya_awards: punyaAwards,
      leaderboard,
    };
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async listForBatch(actor: ScopedActor, batchId: string): Promise<PushQuiz[]> {
    if (actor.role === 'shikshak') {
      if (!(actor.batch_ids ?? []).includes(batchId)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Batch is not yours',
          statusCode: 403,
        });
      }
    }
    return this.repo.listForBatch(batchId);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private toPublicQuestion(q: PushQuizQuestion, startedAtMs: number): PushQuizPublicQuestion {
    const opts = Array.isArray(q.options)
      ? (q.options as Array<{ id: string; text_en: string; text_hi: string }>).map((o) => ({
          id: o.id,
          text_en: o.text_en,
          text_hi: o.text_hi,
        }))
      : [];
    return {
      id: q.id,
      order_index: q.order_index,
      question_en: q.question_en,
      question_hi: q.question_hi,
      expires_at: new Date(startedAtMs + PUSH_QUIZ_QUESTION_WINDOW_MS).toISOString(),
      options: opts,
    };
  }

  private async emitAggregatedAnswerCounts(
    quizId: string,
    questionId: string,
    options: unknown,
  ): Promise<void> {
    try {
      const attempts = await this.repo.listAttempts(quizId);
      const optsLen = Array.isArray(options) ? options.length : 0;
      const counts = Array.from({ length: optsLen }, () => 0);
      for (const a of attempts) {
        const map = (a.answers as Record<string, PushQuizAnswerRecord> | null) ?? {};
        const record = map[questionId];
        if (
          record &&
          typeof record.selected_option_index === 'number' &&
          record.selected_option_index >= 0 &&
          record.selected_option_index < optsLen
        ) {
          counts[record.selected_option_index] = (counts[record.selected_option_index] ?? 0) + 1;
        }
      }
      this.realtime.emit(`${NAMESPACES.PUSH_QUIZZES}/${quizId}`, 'quiz.answer_received', {
        quiz_id: quizId,
        question_id: questionId,
        counts,
        total_participants: attempts.length,
      });
    } catch (err) {
      this.logger.warn(`answer-aggregate emit failed: ${(err as Error).message}`);
    }
  }

  private activeKey(quizId: string): string {
    return `pq:active:${quizId}`;
  }

  private async readActive(quizId: string): Promise<ActiveQuestionState | null> {
    const raw = await this.redis.cacheClient.get(this.activeKey(quizId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ActiveQuestionState;
    } catch {
      return null;
    }
  }

  private async writeActive(quizId: string, state: ActiveQuestionState): Promise<void> {
    // TTL 1 hour — push quizzes are always short-lived.
    await this.redis.cacheClient.set(this.activeKey(quizId), JSON.stringify(state), 'EX', 3600);
  }

  private async requireQuiz(id: string): Promise<PushQuiz> {
    const q = await this.repo.findById(id);
    if (!q) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_NOT_FOUND,
        message: 'Push quiz not found',
        statusCode: 404,
      });
    }
    return q;
  }

  private async requireStudent(id: string): Promise<Student> {
    const s = await this.students.findById(id);
    if (!s) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    return s;
  }

  private assertCanInitiate(actor: ScopedActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin', 'sanchalak', 'shikshak'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only shikshak+ can manage push quizzes',
        statusCode: 403,
      });
    }
  }

  private assertCanShikshakOperate(actor: ScopedActor, quiz: PushQuiz): void {
    if (actor.role === 'shikshak' && quiz.shikshak_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'You do not own this push quiz',
        statusCode: 403,
      });
    }
  }
}
