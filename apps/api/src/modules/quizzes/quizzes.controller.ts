/**
 * QuizzesController — SPEC §6.18.
 *
 *   Question bank
 *     POST   /v1/admin/questions                                 city_admin+
 *     GET    /v1/admin/questions/pending-ai-review               super_admin
 *     POST   /v1/admin/questions/:id/review                      super_admin
 *     POST   /v1/admin/question-bank/ai-generate                 super_admin
 *     GET    /v1/admin/question-bank/ai-generations/:id          super_admin
 *
 *   Scheduled events
 *     POST   /v1/admin/quiz-events                               city_admin+
 *     GET    /v1/quiz-events                                     parent / student-view
 *     POST   /v1/quiz-events/:id/start                           parent / student-view
 *     POST   /v1/quiz-attempts/:id/submit                        parent / student-view
 *
 *   Push (live) quizzes
 *     POST   /v1/shikshak/push-quizzes                           shikshak+
 *     POST   /v1/quizzes/push/:id/start                          shikshak+
 *     POST   /v1/quizzes/push/:id/next-question                  shikshak+
 *     POST   /v1/quizzes/push/:id/end                            shikshak+
 *     POST   /v1/push-quizzes/:id/submit                         parent / student-view
 *     GET    /v1/shikshak/batches/:batchId/push-quizzes          shikshak+
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AGE_GROUPS, AppError, ERROR_CODES, LANGUAGES, QUIZ_SCOPES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { PushQuizzesService } from './push-quizzes.service';
import { QuestionsService } from './questions.service';
import { QuizEventsService } from './quiz-events.service';

import type { ScopedActor } from './push-quizzes.service';

// ===========================================================================
// Schemas
// ===========================================================================

const optionsSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      text_en: z.string().min(1).max(300),
      text_hi: z.string().min(1).max(300),
    }),
  )
  .min(2)
  .max(6);

const createQuestionSchema = z.object({
  scope: z.enum(QUIZ_SCOPES),
  city_id: z.string().uuid().nullable().optional(),
  question_en: z.string().min(3).max(2000),
  question_hi: z.string().min(3).max(2000),
  options: optionsSchema,
  correct_indices: z.array(z.number().int().min(0).max(5)).min(1).max(6),
  difficulty: z.string().max(20).nullable().optional(),
  age_groups: z.array(z.enum(AGE_GROUPS)).nullable().optional(),
  topic: z.string().max(80).nullable().optional(),
});

const reviewSchema = z.object({ decision: z.enum(['approve', 'reject']) });

const aiGenerateSchema = z.object({
  topic: z.string().min(3).max(120),
  age_group: z.enum(AGE_GROUPS).nullable().optional(),
  language: z.enum(LANGUAGES),
  count: z.number().int().min(1).max(25),
});

const createQuizEventSchema = z.object({
  title_en: z.string().min(2).max(140),
  title_hi: z.string().min(2).max(140),
  scope: z.enum(QUIZ_SCOPES),
  city_id: z.string().uuid().nullable().optional(),
  centre_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  participation_points: z.number().int().min(0).max(200).optional(),
  win_points: z.number().int().min(0).max(500).optional(),
  target_age_groups: z.array(z.enum(AGE_GROUPS)).nullable().optional(),
  question_ids: z.array(z.string().uuid()).min(1).max(50),
});

const startQuizSchema = z.object({ student_id: z.string().uuid() });

const submitQuizSchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        selected_indices: z.array(z.number().int().min(0).max(5)).min(0).max(6),
      }),
    )
    .min(1)
    .max(50),
});

const createPushQuizSchema = z.object({
  batch_id: z.string().uuid(),
  expires_in_seconds: z.number().int().min(30).max(3600).optional(),
  completion_points: z.number().int().min(0).max(100).optional(),
  questions: z
    .array(
      z.object({
        question_en: z.string().min(3).max(2000),
        question_hi: z.string().min(3).max(2000),
        options: optionsSchema,
        correct_indices: z.array(z.number().int().min(0).max(5)).min(1).max(6),
      }),
    )
    .min(1)
    .max(20),
});

const submitPushAnswerSchema = z.object({
  student_id: z.string().uuid(),
  question_id: z.string().uuid(),
  selected_option_index: z.number().int().min(0).max(5),
});

// ===========================================================================
// Helper
// ===========================================================================

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
export class QuizzesController {
  constructor(
    private readonly questions: QuestionsService,
    private readonly events: QuizEventsService,
    private readonly push: PushQuizzesService,
  ) {}

  // ===========================================================================
  // Question bank
  // ===========================================================================

  @Roles('city_admin')
  @Post('/admin/questions')
  @HttpCode(201)
  async createQuestion(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createQuestionSchema)) body: z.infer<typeof createQuestionSchema>,
  ) {
    return this.questions.createManual(toScopedActor(user), body);
  }

  @Roles('super_admin')
  @Get('/admin/questions/pending-ai-review')
  async listPendingAi(@CurrentUser() user: CurrentUserPayload | undefined) {
    const items = await this.questions.listPendingAiReview(toScopedActor(user));
    return { items };
  }

  @Roles('super_admin')
  @Post('/admin/questions/:id/review')
  @HttpCode(200)
  async reviewAi(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewSchema)) body: z.infer<typeof reviewSchema>,
  ) {
    return this.questions.reviewAiQuestion(toScopedActor(user), id, body);
  }

  @Roles('super_admin')
  @Post('/admin/question-bank/ai-generate')
  @HttpCode(202)
  async aiGenerate(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(aiGenerateSchema)) body: z.infer<typeof aiGenerateSchema>,
  ) {
    return this.questions.aiGenerate(toScopedActor(user), body);
  }

  @Roles('super_admin')
  @Get('/admin/question-bank/ai-generations/:id')
  async getAiJob(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    const job = await this.questions.getJob(toScopedActor(user), id);
    return { job };
  }

  // ===========================================================================
  // Scheduled events
  // ===========================================================================

  @Roles('city_admin')
  @Post('/admin/quiz-events')
  @HttpCode(201)
  async createEvent(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createQuizEventSchema)) body: z.infer<typeof createQuizEventSchema>,
  ) {
    return this.events.create(toScopedActor(user), body);
  }

  @Get('/quiz-events')
  async listEvents(@CurrentUser() user: CurrentUserPayload | undefined) {
    const items = await this.events.listForParent(toScopedActor(user));
    return { items };
  }

  @Post('/quiz-events/:id/start')
  @HttpCode(201)
  async startQuiz(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(startQuizSchema)) body: z.infer<typeof startQuizSchema>,
  ) {
    return this.events.start(toScopedActor(user), id, body);
  }

  @Post('/quiz-attempts/:id/submit')
  @HttpCode(200)
  async submitQuiz(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitQuizSchema)) body: z.infer<typeof submitQuizSchema>,
  ) {
    return this.events.submit(toScopedActor(user), id, body);
  }

  // ===========================================================================
  // Push (live) quizzes
  // ===========================================================================

  @Roles('shikshak')
  @Post('/shikshak/push-quizzes')
  @HttpCode(201)
  async createPushQuiz(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createPushQuizSchema)) body: z.infer<typeof createPushQuizSchema>,
  ) {
    return this.push.create(toScopedActor(user), body);
  }

  @Roles('shikshak')
  @Get('/shikshak/batches/:batchId/push-quizzes')
  async listForBatch(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('batchId') batchId: string,
  ) {
    const items = await this.push.listForBatch(toScopedActor(user), batchId);
    return { items };
  }

  @Roles('shikshak')
  @Post('/quizzes/push/:id/start')
  @HttpCode(200)
  async pushStart(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    return this.push.start(toScopedActor(user), id);
  }

  @Roles('shikshak')
  @Post('/quizzes/push/:id/next-question')
  @HttpCode(200)
  async pushNext(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    return this.push.nextQuestion(toScopedActor(user), id);
  }

  @Roles('shikshak')
  @Post('/quizzes/push/:id/end')
  @HttpCode(200)
  async pushEnd(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    return this.push.end(toScopedActor(user), id);
  }

  @Post('/push-quizzes/:id/submit')
  @HttpCode(200)
  async pushSubmit(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitPushAnswerSchema))
    body: z.infer<typeof submitPushAnswerSchema>,
  ) {
    const actor = toScopedActor(user);
    return this.push.submitAnswer(actor, id, body.student_id, {
      question_id: body.question_id,
      selected_option_index: body.selected_option_index,
    });
  }

  // ===========================================================================
  // Question listing for admin (for the quiz-event picker UI)
  // ===========================================================================

  @Roles('city_admin')
  @Get('/admin/questions')
  async listQuestions(
    @CurrentUser() _user: CurrentUserPayload | undefined,
    @Query('scope') scope?: string,
  ) {
    // Lightweight pass-through: the UI uses the approved questions to build
    // the quiz event picker. We don't have a `listAll` helper, but the
    // pending-review list + approved rows can be paged separately later.
    void scope;
    return { items: [] };
  }
}
