/**
 * ExamsController — `/v1/admin/exams/*` and `/v1/exams/*` (SPEC §6.17, §8.9).
 *
 *   POST   /v1/admin/exams                                       city_admin+
 *   POST   /v1/admin/exams/:id/otp                               city_admin+ — generates the class OTP
 *   POST   /v1/admin/exam-attempts/:attempt_id/grade/:answer_id  city_admin+ — short-text grading
 *   POST   /v1/admin/exams/:id/release-results                   city_admin+
 *
 *   GET    /v1/exams                                             parent / scoped
 *   POST   /v1/exams/:id/start                                   parent / student-view
 *   POST   /v1/exam-attempts/:id/answer                          parent / student-view (autosave)
 *   POST   /v1/exam-attempts/:id/submit                          parent / student-view
 */

import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, EXAM_QUESTION_TYPES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { ExamsService, type ScopedActor } from './exams.service';

const questionSchema = z.object({
  question_type: z.enum(EXAM_QUESTION_TYPES),
  question_en: z.string().min(2).max(2000),
  question_hi: z.string().min(2).max(2000),
  marks: z.number().int().min(1).max(100),
  order_index: z.number().int().min(0).max(1000),
  options: z
    .array(
      z.object({
        label_en: z.string().min(1).max(500),
        label_hi: z.string().min(1).max(500),
        is_correct: z.boolean(),
        order_index: z.number().int().min(0).max(100),
      }),
    )
    .optional(),
});

const createExamSchema = z.object({
  title_en: z.string().min(2).max(200),
  title_hi: z.string().min(2).max(200),
  description_en: z.string().max(4000).optional(),
  description_hi: z.string().max(4000).optional(),
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
  max_attempts: z.number().int().min(1).max(5).optional(),
  pass_mark: z.number().int().min(0),
  completion_points: z.number().int().min(0).max(200).optional(),
  top_score_points: z.number().int().min(0).max(500).optional(),
  show_rank: z.boolean().optional(),
  questions: z.array(questionSchema).min(1).max(200),
});

const startSchema = z.object({
  student_id: z.string().uuid(),
  exam_otp: z.string().regex(/^\d{6}$/),
});

const saveAnswerSchema = z
  .object({
    question_id: z.string().uuid(),
    selected_option_ids: z.array(z.string().uuid()).optional(),
    short_text_answer: z.string().max(4000).optional(),
  })
  .refine((v) => v.selected_option_ids || v.short_text_answer !== undefined, {
    message: 'Provide selected_option_ids or short_text_answer',
  });

const gradeSchema = z.object({
  manual_score: z.number().int().min(0),
  admin_comment: z.string().max(500).optional(),
});

function toScopedActor(user: CurrentUserPayload | undefined): ScopedActor {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
  const out: ScopedActor = { user_id: user.sub, role: user.role };
  if (user.scope.city_id) out.city_id = user.scope.city_id;
  if (user.scope.centre_ids) out.centre_ids = user.scope.centre_ids;
  if (user.scope.batch_ids) out.batch_ids = user.scope.batch_ids;
  return out;
}

@Controller('/v1')
export class ExamsController {
  constructor(private readonly service: ExamsService) {}

  // ===========================================================================
  // Admin
  // ===========================================================================

  @Roles('city_admin')
  @Post('/admin/exams')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createExamSchema)) body: z.infer<typeof createExamSchema>,
  ) {
    return this.service.create(toScopedActor(user), {
      title_en: body.title_en,
      title_hi: body.title_hi,
      description_en: body.description_en ?? null,
      description_hi: body.description_hi ?? null,
      window_start: body.window_start,
      window_end: body.window_end,
      ...(body.max_attempts !== undefined ? { max_attempts: body.max_attempts } : {}),
      pass_mark: body.pass_mark,
      ...(body.completion_points !== undefined
        ? { completion_points: body.completion_points }
        : {}),
      ...(body.top_score_points !== undefined ? { top_score_points: body.top_score_points } : {}),
      ...(body.show_rank !== undefined ? { show_rank: body.show_rank } : {}),
      questions: body.questions.map((q) => ({
        question_type: q.question_type,
        question_en: q.question_en,
        question_hi: q.question_hi,
        marks: q.marks,
        order_index: q.order_index,
        ...(q.options ? { options: q.options } : {}),
      })),
    });
  }

  @Roles('city_admin')
  @Post('/admin/exams/:id/otp')
  @HttpCode(201)
  async generateOtp(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    return this.service.generateOtp(toScopedActor(user), id);
  }

  @Roles('city_admin')
  @Post('/admin/exams/:id/release-results')
  @HttpCode(200)
  async releaseResults(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.service.releaseResults(toScopedActor(user), id);
  }

  @Roles('city_admin')
  @Post('/admin/exam-attempts/:attempt_id/grade/:answer_id')
  @HttpCode(200)
  async gradeAnswer(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('attempt_id') attemptId: string,
    @Param('answer_id') answerId: string,
    @Body(new ZodValidationPipe(gradeSchema)) body: z.infer<typeof gradeSchema>,
  ) {
    return this.service.gradeAnswer(toScopedActor(user), attemptId, answerId, {
      manual_score: body.manual_score,
      ...(body.admin_comment !== undefined ? { admin_comment: body.admin_comment } : {}),
    });
  }

  // ===========================================================================
  // Parent / student-view
  // ===========================================================================

  @Get('/exams')
  async listForCaller(@CurrentUser() user: CurrentUserPayload | undefined) {
    const items = await this.service.listForCaller(toScopedActor(user));
    return { items };
  }

  @Post('/exams/:id/start')
  @HttpCode(201)
  async start(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>,
  ) {
    return this.service.startAttempt(toScopedActor(user), id, {
      student_id: body.student_id,
      exam_otp: body.exam_otp,
    });
  }

  @Post('/exam-attempts/:id/answer')
  @HttpCode(200)
  async saveAnswer(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') attemptId: string,
    @Body(new ZodValidationPipe(saveAnswerSchema)) body: z.infer<typeof saveAnswerSchema>,
  ) {
    return this.service.saveAnswer(toScopedActor(user), attemptId, {
      question_id: body.question_id,
      ...(body.selected_option_ids ? { selected_option_ids: body.selected_option_ids } : {}),
      ...(body.short_text_answer !== undefined
        ? { short_text_answer: body.short_text_answer }
        : {}),
    });
  }

  @Post('/exam-attempts/:id/submit')
  @HttpCode(200)
  async submit(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') attemptId: string,
  ) {
    return this.service.submitAttempt(toScopedActor(user), attemptId);
  }
}
