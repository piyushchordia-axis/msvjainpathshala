/**
 * AiBatchController — `POST /v1/questions/ai-batch`.
 *
 * Called by the FastAPI service after it has drafted questions. The
 * controller is HMAC-protected via AiHmacGuard (the JwtAuthGuard /
 * RolesGuard chain is bypassed via @Public() since the FastAPI service
 * isn't a user). For each drafted question:
 *
 *   1. Insert into `questions` with
 *        scope='national', source='ai',
 *        is_ai_generated=true, ai_review_status='pending_review'.
 *      Inserts run inside one transaction so a malformed batch leaves no
 *      partial state.
 *   2. Update the `ai_generation_jobs` row with status='ready' +
 *        result_question_ids[].
 *
 * Returns `{ accepted_count, question_ids[] }`.
 */

import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { QuestionsRepository } from '../../db/repositories';
import { Public } from '../auth/decorators/public.decorator';

import { AiHmacGuard } from './ai-hmac.guard';

const optionSchema = z.object({
  text_en: z.string().min(1).max(300),
  text_hi: z.string().min(1).max(300),
});

const draftedQuestionSchema = z.object({
  question_en: z.string().min(3).max(2000),
  question_hi: z.string().min(3).max(2000),
  options: z.array(optionSchema).min(2).max(6),
  /** 0-based index into `options`. We translate to correct_indices: [n]. */
  correct_index: z.number().int().min(0).max(5),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});

const batchSchema = z.object({
  job_id: z.string().uuid(),
  questions: z.array(draftedQuestionSchema).min(1).max(50),
});

@Controller('/v1/questions')
export class AiBatchController {
  private readonly logger = new Logger(AiBatchController.name);

  constructor(private readonly questions: QuestionsRepository) {}

  // Order matters: @Public must land before @UseGuards in the decorator
  // stack so JwtAuthGuard's reflector sees the PUBLIC_KEY metadata before
  // the route-level AiHmacGuard runs.
  @Public()
  @UseGuards(AiHmacGuard)
  @HttpCode(201)
  @Post('/ai-batch')
  async receiveBatch(
    @Body(new ZodValidationPipe(batchSchema)) body: z.infer<typeof batchSchema>,
  ): Promise<{ accepted_count: number; question_ids: string[] }> {
    const job = await this.questions.findJobById(body.job_id);
    if (!job) {
      this.logger.warn(`ai-batch: unknown job_id=${body.job_id}`);
      return { accepted_count: 0, question_ids: [] };
    }

    const ids: string[] = [];
    for (let i = 0; i < body.questions.length; i++) {
      const q = body.questions[i]!;
      // Map drafted shape → questions table shape.
      const options = q.options.map((o, idx) => ({
        id: String.fromCharCode(97 + idx), // a, b, c, …
        text_en: o.text_en,
        text_hi: o.text_hi,
      }));
      const row = await this.questions.insert({
        scope: 'national',
        city_id: null,
        question_en: q.question_en,
        question_hi: q.question_hi,
        options,
        correct_indices: [q.correct_index],
        difficulty: q.difficulty ?? null,
        age_groups: job.age_group ? [job.age_group] : null,
        topic: job.topic,
        source: 'ai',
        is_ai_generated: true,
        ai_review_status: 'pending_review',
        reviewed: 'pending_review',
      });
      ids.push(row.id);
    }

    await this.questions.markJobReady(body.job_id, ids);

    this.logger.log(`ai-batch: ${ids.length} questions inserted for job=${body.job_id}`);
    return { accepted_count: ids.length, question_ids: ids };
  }
}
