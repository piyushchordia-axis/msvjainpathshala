/**
 * NiyamsController — `/v1/niyams/*` and `/v1/admin/niyams/*`
 * (SPEC §6.10).
 *
 * Endpoint surface:
 *
 *   POST   /v1/admin/niyams                          shikshak+ (scope-bound)
 *   GET    /v1/admin/niyams                          shikshak+ — city-scoped list
 *   GET    /v1/admin/niyam-submissions               shikshak+ — submissions grid
 *   POST   /v1/admin/niyam-submissions/:id/reject    shikshak+ — Q5: 30-day window
 *
 *   GET    /v1/niyams                                parent / student-view — list for student
 *   POST   /v1/niyams/:id/submissions                parent — auto-approve + Punya
 *   GET    /v1/students/:id/niyams/recent            parent/admin — recent submissions
 *   GET    /v1/students/:id/niyam-streaks            parent/admin — per-niyam streaks
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, NIYAM_TYPES, PROOF_TYPES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { NiyamsService, type ScopedActor } from './niyams.service';

const audienceFiltersSchema = z
  .object({
    age_groups: z.array(z.string()).optional(),
    batch_ids: z.array(z.string().uuid()).optional(),
    centre_ids: z.array(z.string().uuid()).optional(),
  })
  .nullable()
  .optional();

const createNiyamSchema = z.object({
  title_en: z.string().min(2).max(140),
  title_hi: z.string().min(2).max(140),
  description_en: z.string().max(1000).optional(),
  description_hi: z.string().max(1000).optional(),
  type: z.enum(NIYAM_TYPES),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  audience_kind: z.enum(['all', 'msv_only', 'age_group', 'batch', 'centre', 'city']),
  audience_filters: audienceFiltersSchema,
  proof_type: z.enum(PROOF_TYPES),
  points_value: z.number().int().min(1).max(200),
  reference_asset_id: z.string().uuid().optional(),
  msv_only: z.boolean().optional(),
});

const submitNiyamSchema = z.object({
  student_id: z.string().uuid(),
  proof_asset_id: z.string().uuid(),
  client_op_id: z.string().min(8).max(64).optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(20).max(500),
});

const listQuerySchema = z.object({
  student_id: z.string().uuid().optional(),
  type: z.enum(NIYAM_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1000).optional(),
});

const adminSubmissionsQuerySchema = z.object({
  niyam_id: z.string().uuid().optional(),
  only_approved: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1000).optional(),
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
export class NiyamsController {
  constructor(private readonly service: NiyamsService) {}

  // ===========================================================================
  // Admin — CRUD
  // ===========================================================================

  @Roles('shikshak')
  @Post('/admin/niyams')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createNiyamSchema)) body: z.infer<typeof createNiyamSchema>,
  ) {
    return this.service.create(toScopedActor(user), {
      title_en: body.title_en,
      title_hi: body.title_hi,
      description_en: body.description_en ?? null,
      description_hi: body.description_hi ?? null,
      type: body.type,
      start_date: body.start_date,
      end_date: body.end_date ?? null,
      audience_kind: body.audience_kind,
      audience_filters: body.audience_filters ?? null,
      proof_type: body.proof_type,
      points_value: body.points_value,
      reference_asset_id: body.reference_asset_id ?? null,
      ...(body.msv_only !== undefined ? { msv_only: body.msv_only } : {}),
    });
  }

  @Roles('shikshak')
  @Get('/admin/niyams')
  async listForAdmin(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    const items = await this.service.listForAdmin(toScopedActor(user), {
      ...(q.type ? { type: q.type } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
    return { items };
  }

  @Roles('shikshak')
  @Get('/admin/niyam-submissions')
  async submissionsForAdmin(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(adminSubmissionsQuerySchema))
    q: z.infer<typeof adminSubmissionsQuerySchema>,
  ) {
    const items = await this.service.listSubmissionsForAdmin(toScopedActor(user), {
      ...(q.niyam_id ? { niyam_id: q.niyam_id } : {}),
      ...(q.only_approved !== undefined ? { only_approved: q.only_approved } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
    return { items };
  }

  @Roles('shikshak')
  @Post('/admin/niyam-submissions/:id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') submissionId: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
  ) {
    return this.service.reject(toScopedActor(user), submissionId, { reason: body.reason });
  }

  // ===========================================================================
  // Parent + student-view
  // ===========================================================================

  @Get('/niyams')
  async listForCaller(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    if (!q.student_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'student_id query param is required',
        statusCode: 422,
      });
    }
    const items = await this.service.listForCaller(toScopedActor(user), q.student_id, {
      ...(q.type ? { type: q.type } : {}),
    });
    return { items };
  }

  @Post('/niyams/:id/submissions')
  @HttpCode(201)
  async submit(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') niyamId: string,
    @Body(new ZodValidationPipe(submitNiyamSchema)) body: z.infer<typeof submitNiyamSchema>,
  ) {
    return this.service.submit(toScopedActor(user), niyamId, {
      student_id: body.student_id,
      proof_asset_id: body.proof_asset_id,
      ...(body.client_op_id ? { client_op_id: body.client_op_id } : {}),
    });
  }

  @Get('/students/:id/niyams/recent')
  async recent(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.min(Math.max(Number(limitRaw ?? 20), 1), 100);
    const items = await this.service.listRecentForStudent(toScopedActor(user), studentId, limit);
    return { items };
  }

  @Get('/students/:id/niyam-streaks')
  async streaks(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
  ) {
    const items = await this.service.listStreaksForStudent(toScopedActor(user), studentId);
    return { items };
  }
}
