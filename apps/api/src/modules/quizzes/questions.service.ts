/**
 * QuestionsService — Step 20 (SPEC §5.14, §6.18).
 *
 * Owns:
 *   1. Manual creation of bank questions. Standard-scope questions land
 *      directly as `ai_review_status='approved'`; MSV scope is implicitly
 *      a super_admin-only path (we never have a per-MSV table here — the
 *      city_id field stays NULL for `scope='national'`).
 *   2. AI generation lifecycle:
 *        - admin POST /v1/admin/question-bank/ai-generate → row in
 *          `ai_generation_jobs` + enqueue `ai.quiz.generate`. Returns
 *          generation id immediately.
 *        - admin GET /v1/admin/question-bank/ai-generations/:id → returns
 *          status + drafted question ids when ready.
 *      The worker side (Step 21) populates the questions table and bumps
 *      the job row; we expose helpers here for both ends.
 *   3. Approve / reject per-question.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { QuestionsRepository } from '../../db/repositories';
import { QUEUES } from '../../queues/queues.constants';
import { AuditService } from '../audit/audit.service';

import type {
  AiGenerateInput,
  AiGenerateResult,
  CreateQuestionInput,
  ReviewAiQuestionInput,
} from './quizzes.types';
import type { AiGenerationJob, Question } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);

  constructor(
    private readonly questions: QuestionsRepository,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.AI_QUIZ_GENERATE) private readonly aiQuizQueue: Queue,
  ) {}

  // ===========================================================================
  // Manual create
  // ===========================================================================

  async createManual(actor: ScopedActor, input: CreateQuestionInput): Promise<Question> {
    this.assertCanAdminWrite(actor);

    // MSV / national scope is super_admin only at the service layer (parallel
    // to Curriculum Q2). For 'state' and 'city' scope, city_admin can create.
    if (
      (input.scope === 'national' || input.scope === 'state') &&
      actor.role !== 'super_admin' &&
      actor.role !== 'state_admin'
    ) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only super/state admin can create national/state-scope questions',
        statusCode: 403,
      });
    }
    if (input.scope === 'city') {
      const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin'];
      if (!allowed.includes(actor.role)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
          message: 'Only city_admin+ can create city-scope questions',
          statusCode: 403,
        });
      }
      if (actor.role === 'city_admin' && (!actor.city_id || actor.city_id !== input.city_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'city_id must match your scope',
          statusCode: 403,
        });
      }
    }
    if (!input.question_en?.trim() || !input.question_hi?.trim()) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_BILINGUAL_REQUIRED,
        message: 'Both question_en and question_hi are required',
        statusCode: 422,
      });
    }
    if (input.options.length < 2 || input.options.length > 6) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'Provide between 2 and 6 options',
        statusCode: 422,
      });
    }
    if (
      input.correct_indices.length === 0 ||
      input.correct_indices.some((i) => i < 0 || i >= input.options.length)
    ) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'correct_indices must reference existing options',
        statusCode: 422,
      });
    }

    const row = await this.questions.insert({
      scope: input.scope,
      city_id: input.city_id ?? null,
      question_en: input.question_en.trim(),
      question_hi: input.question_hi.trim(),
      options: input.options,
      correct_indices: input.correct_indices,
      difficulty: input.difficulty ?? null,
      age_groups: input.age_groups ?? null,
      topic: input.topic ?? null,
      source: 'manual',
      is_ai_generated: false,
      ai_review_status: 'approved',
      reviewed: 'approved',
      reviewed_by: actor.user_id,
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'question',
        entity_id: row.id,
        after: { scope: row.scope, city_id: row.city_id, source: 'manual' },
      })
      .catch(() => undefined);

    return row;
  }

  // ===========================================================================
  // AI generation
  // ===========================================================================

  async aiGenerate(actor: ScopedActor, input: AiGenerateInput): Promise<AiGenerateResult> {
    if (actor.role !== 'super_admin') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only super_admin can request AI quiz generation',
        statusCode: 403,
      });
    }
    if (!input.topic?.trim() || input.topic.trim().length < 3) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'topic must be at least 3 characters',
        statusCode: 422,
      });
    }
    const count = Math.min(Math.max(input.count ?? 10, 1), 25);

    const job = await this.questions.insertJob({
      actor_user_id: actor.user_id,
      topic: input.topic.trim(),
      age_group: input.age_group ?? null,
      language: input.language,
      count,
      status: 'queued',
    });

    // Enqueue the AI worker. The Step-21 processor reads the row, calls the
    // FastAPI service, inserts the drafted questions into `questions` with
    // is_ai_generated=true, ai_review_status='pending_review', then sets
    // status='ready' + result_question_ids[].
    await this.aiQuizQueue
      .add(
        'ai.quiz.generate',
        {
          job_id: job.id,
          topic: job.topic,
          age_group: job.age_group,
          language: job.language,
          count,
        },
        { jobId: `ai.quiz.generate:${job.id}`, removeOnComplete: true },
      )
      .catch((err) => {
        this.logger.warn(`Failed to enqueue ai.quiz.generate: ${(err as Error).message}`);
      });

    return { job };
  }

  async getJob(actor: ScopedActor, jobId: string): Promise<AiGenerationJob> {
    if (actor.role !== 'super_admin') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only super_admin can read AI generation jobs',
        statusCode: 403,
      });
    }
    const job = await this.questions.findJobById(jobId);
    if (!job) {
      throw new AppError({
        code: ERROR_CODES.ERR_AI_JOB_NOT_FOUND,
        message: 'AI generation job not found',
        statusCode: 404,
      });
    }
    return job;
  }

  // ===========================================================================
  // Approve / reject pending AI questions
  // ===========================================================================

  async listPendingAiReview(actor: ScopedActor): Promise<Question[]> {
    if (actor.role !== 'super_admin') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only super_admin can review AI-generated questions',
        statusCode: 403,
      });
    }
    return this.questions.listPendingAiReview(50);
  }

  async reviewAiQuestion(
    actor: ScopedActor,
    questionId: string,
    input: ReviewAiQuestionInput,
  ): Promise<Question> {
    if (actor.role !== 'super_admin') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only super_admin can review AI-generated questions',
        statusCode: 403,
      });
    }
    const existing = await this.questions.findById(questionId);
    if (!existing) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_QUESTION_NOT_FOUND,
        message: 'Question not found',
        statusCode: 404,
      });
    }
    const newStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    const updated = await this.questions.update(questionId, {
      ai_review_status: newStatus,
      reviewed: newStatus,
      reviewed_by: actor.user_id,
    });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'Review failed',
        statusCode: 500,
      });
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: input.decision === 'approve' ? 'approve' : 'reject',
        entity_kind: 'question',
        entity_id: questionId,
        before: { ai_review_status: existing.ai_review_status },
        after: { ai_review_status: newStatus },
      })
      .catch(() => undefined);
    return updated;
  }

  // ===========================================================================
  // Helpers shared with QuizEventsService
  // ===========================================================================

  /**
   * Resolve a set of approved question rows for use in a quiz event. Refuses
   * AI-generated rows that are still pending or were rejected.
   */
  async resolveApproved(questionIds: string[]): Promise<Question[]> {
    if (questionIds.length === 0) return [];
    const rows = await this.questions.listByIds(questionIds);
    if (rows.length !== questionIds.length) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_QUESTION_NOT_FOUND,
        message: 'One or more questions not found',
        statusCode: 404,
      });
    }
    const unapproved = rows.filter((q) => q.ai_review_status === 'pending_review');
    if (unapproved.length > 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_QUIZ_QUESTION_NOT_APPROVED,
        message: `Question ${unapproved[0]!.id} has not been reviewed yet`,
        statusCode: 409,
      });
    }
    return rows;
  }

  // ===========================================================================
  // RBAC
  // ===========================================================================

  private assertCanAdminWrite(actor: ScopedActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only city_admin+ can write to the question bank',
        statusCode: 403,
      });
    }
  }
}
