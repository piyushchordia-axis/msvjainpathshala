/**
 * HomeworkController — `/v1/homework/*` and `/v1/admin/homework/*`
 * (SPEC §6.12).
 *
 *   POST   /v1/admin/homework                                           shikshak+
 *   GET    /v1/admin/homework/:id/submissions                           shikshak+
 *   POST   /v1/admin/homework/:id/submissions/:student_id/grade         shikshak+
 *
 *   GET    /v1/students/:id/homework                                    parent / student-view
 *   POST   /v1/homework/:id/mark-done                                   parent / student-view
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { HomeworkService, type ScopedActor } from './homework.service';

const createHomeworkSchema = z.object({
  batch_id: z.string().uuid(),
  title: z.string().min(2).max(140),
  description: z.string().max(2000).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attachment_asset_id: z.string().uuid().optional(),
  target_student_ids: z.array(z.string().uuid()).optional(),
  is_msv: z.boolean().optional(),
});

const markDoneSchema = z.object({
  student_id: z.string().uuid(),
  submission_asset_id: z.string().uuid().optional(),
});

const gradeSchema = z.object({
  status: z.enum(['approved', 'starred']),
  feedback_note: z.string().max(500).optional(),
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
export class HomeworkController {
  constructor(private readonly service: HomeworkService) {}

  // ===========================================================================
  // Admin
  // ===========================================================================

  @Roles('shikshak')
  @Post('/admin/homework')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createHomeworkSchema)) body: z.infer<typeof createHomeworkSchema>,
  ) {
    const result = await this.service.assign(toScopedActor(user), {
      batch_id: body.batch_id,
      title: body.title,
      description: body.description ?? null,
      due_date: body.due_date,
      attachment_asset_id: body.attachment_asset_id ?? null,
      target_student_ids: body.target_student_ids ?? null,
      ...(body.is_msv !== undefined ? { is_msv: body.is_msv } : {}),
    });
    return result;
  }

  @Roles('shikshak')
  @Get('/admin/homework/:id/submissions')
  async listSubmissions(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') assignmentId: string,
  ) {
    const items = await this.service.listSubmissionsForAdmin(toScopedActor(user), assignmentId);
    return { items };
  }

  @Roles('shikshak')
  @Post('/admin/homework/:id/submissions/:student_id/grade')
  @HttpCode(200)
  async grade(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') assignmentId: string,
    @Param('student_id') studentId: string,
    @Body(new ZodValidationPipe(gradeSchema)) body: z.infer<typeof gradeSchema>,
  ) {
    return this.service.grade(toScopedActor(user), assignmentId, studentId, {
      status: body.status,
      feedback_note: body.feedback_note ?? null,
    });
  }

  // ===========================================================================
  // Parent + student-view
  // ===========================================================================

  @Get('/students/:id/homework')
  async listForStudent(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
    @Query('limit') _limit?: string,
  ) {
    const items = await this.service.listForStudent(toScopedActor(user), studentId);
    return { items };
  }

  @Post('/homework/:id/mark-done')
  @HttpCode(200)
  async markDone(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') assignmentId: string,
    @Body(new ZodValidationPipe(markDoneSchema)) body: z.infer<typeof markDoneSchema>,
  ) {
    return this.service.markDone(toScopedActor(user), assignmentId, {
      student_id: body.student_id,
      submission_asset_id: body.submission_asset_id ?? null,
    });
  }
}
