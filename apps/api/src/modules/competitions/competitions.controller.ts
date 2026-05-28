/**
 * CompetitionsController — `/v1/competitions/*` and `/v1/admin/competitions/*`
 * (SPEC §6.15).
 *
 *   POST   /v1/admin/competitions                            city_admin+
 *   GET    /v1/admin/competitions                            city_admin+
 *   GET    /v1/admin/competitions/:id/registrations          city_admin+
 *   POST   /v1/admin/competitions/:id/results                city_admin+
 *   POST   /v1/admin/competitions/:id/publish-results        city_admin+
 *
 *   GET    /v1/competitions                                  jwt — scoped feed
 *   POST   /v1/competitions/:id/register                     parent / student-view
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AGE_GROUPS, AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { CompetitionsService, type ScopedActor } from './competitions.service';

const createSchema = z.object({
  name_en: z.string().min(2).max(140),
  name_hi: z.string().min(2).max(140),
  description_en: z.string().max(2000).optional(),
  description_hi: z.string().max(2000).optional(),
  category: z.string().max(80).optional(),
  eligible_age_groups: z.array(z.enum(AGE_GROUPS)).optional(),
  msv_only: z.boolean().optional(),
  registration_window_start: z.string().datetime().optional(),
  registration_window_end: z.string().datetime().optional(),
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  winner_points: z.number().int().min(0).max(500).optional(),
  participant_points: z.number().int().min(0).max(200).optional(),
  max_participants: z.number().int().min(1).max(5000).optional(),
  status: z.enum(['draft', 'open', 'closed', 'results_published']).optional(),
});

const registerSchema = z.object({ student_id: z.string().uuid() });

const resultsSchema = z.object({
  results: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        rank: z.number().int().min(1).max(1000).nullable(),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1),
});

const adminListQuery = z.object({
  status: z.enum(['draft', 'open', 'closed', 'results_published']).optional(),
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
export class CompetitionsController {
  constructor(private readonly service: CompetitionsService) {}

  // ===========================================================================
  // Admin
  // ===========================================================================

  @Roles('city_admin')
  @Post('/admin/competitions')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.service.create(toScopedActor(user), {
      name_en: body.name_en,
      name_hi: body.name_hi,
      description_en: body.description_en ?? null,
      description_hi: body.description_hi ?? null,
      category: body.category ?? null,
      eligible_age_groups: body.eligible_age_groups ?? null,
      ...(body.msv_only !== undefined ? { msv_only: body.msv_only } : {}),
      registration_window_start: body.registration_window_start ?? null,
      registration_window_end: body.registration_window_end ?? null,
      event_date: body.event_date ?? null,
      ...(body.winner_points !== undefined ? { winner_points: body.winner_points } : {}),
      ...(body.participant_points !== undefined
        ? { participant_points: body.participant_points }
        : {}),
      max_participants: body.max_participants ?? null,
      ...(body.status ? { status: body.status } : {}),
    });
  }

  @Roles('city_admin')
  @Get('/admin/competitions')
  async listAdmin(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(adminListQuery)) q: z.infer<typeof adminListQuery>,
  ) {
    const items = await this.service.listForAdmin(toScopedActor(user), {
      ...(q.status ? { status: q.status } : {}),
    });
    return { items };
  }

  @Roles('city_admin')
  @Get('/admin/competitions/:id/registrations')
  async listRegistrations(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
  ) {
    const items = await this.service.listRegistrations(toScopedActor(user), id);
    return { items };
  }

  @Roles('city_admin')
  @Post('/admin/competitions/:id/results')
  @HttpCode(200)
  async recordResults(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resultsSchema)) body: z.infer<typeof resultsSchema>,
  ) {
    return this.service.recordResults(toScopedActor(user), id, { results: body.results });
  }

  @Roles('city_admin')
  @Post('/admin/competitions/:id/publish-results')
  @HttpCode(200)
  async publishResults(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.service.publishResults(toScopedActor(user), id);
  }

  // ===========================================================================
  // Parent + student-view
  // ===========================================================================

  @Get('/competitions')
  async listForCaller(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query('student_id') studentId?: string,
  ) {
    const items = await this.service.listForCaller(toScopedActor(user), studentId);
    return { items };
  }

  @Post('/competitions/:id/register')
  @HttpCode(201)
  async register(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(registerSchema)) body: z.infer<typeof registerSchema>,
  ) {
    return this.service.register(toScopedActor(user), id, { student_id: body.student_id });
  }
}
