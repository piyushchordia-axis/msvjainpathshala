/**
 * CurriculumController — `/v1/admin/curricula/*` and `/v1/students/:id/curriculum-progress`
 * (SPEC §6.16).
 *
 *   POST   /v1/admin/curricula                              city_admin (Standard) / super_admin (MSV via service)
 *   GET    /v1/admin/curricula?kind=msv|standard            scoped
 *   POST   /v1/admin/curricula/:id/sections                 scoped
 *   POST   /v1/admin/curricula/:id/items                    scoped
 *   POST   /v1/admin/curricula/:id/assign                   scoped
 *   POST   /v1/admin/curricula/:id/status                   scoped (draft|active|archived)
 *
 *   GET    /v1/admin/curricula/:id/tree                     scoped admin
 *   POST   /v1/admin/students/:id/curriculum-progress       shikshak/sanchalak
 *   GET    /v1/students/:id/curriculum-progress             parent / scoped admin
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, CURRICULUM_LEVELS, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { CurriculumService, type ScopedActor } from './curriculum.service';

const createSchema = z.object({
  kind: z.enum(['standard', 'msv']),
  name: z.string().min(2).max(140),
  academic_year: z.string().max(40).optional(),
  template_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

const sectionSchema = z.object({
  title_en: z.string().min(1).max(140),
  title_hi: z.string().min(1).max(140),
  order_index: z.number().int().min(0).max(1000),
});

const itemSchema = z.object({
  section_id: z.string().uuid(),
  title_en: z.string().min(1).max(180),
  title_hi: z.string().min(1).max(180),
  description_en: z.string().max(2000).optional(),
  description_hi: z.string().max(2000).optional(),
  order_index: z.number().int().min(0).max(1000),
});

const assignSchema = z
  .object({
    centre_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
  })
  .refine((v) => v.centre_id || v.batch_id, {
    message: 'centre_id or batch_id is required',
  });

const progressSchema = z.object({
  item_id: z.string().uuid(),
  level: z.enum(CURRICULUM_LEVELS),
  note: z.string().max(500).optional(),
});

const listQuery = z.object({
  kind: z.enum(['standard', 'msv']).optional(),
});

const statusSchema = z.object({ status: z.enum(['draft', 'active', 'archived']) });

const progressListQuery = z.object({ curriculum_id: z.string().uuid().optional() });

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
export class CurriculumController {
  constructor(private readonly service: CurriculumService) {}

  // ===========================================================================
  // Admin
  // ===========================================================================

  /**
   * Note: we intentionally accept `super_admin` callers without `@Roles`
   * narrowing — the service-layer Q2 enforcement is the real gate. For
   * Standard curricula `city_admin` is allowed; the service double-checks.
   */
  @Roles('city_admin')
  @Post('/admin/curricula')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.service.createCurriculum(toScopedActor(user), {
      kind: body.kind,
      name: body.name,
      academic_year: body.academic_year ?? null,
      template_id: body.template_id ?? null,
      ...(body.status ? { status: body.status } : {}),
    });
  }

  @Roles('city_admin')
  @Get('/admin/curricula')
  async listAdmin(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    const items = await this.service.listForAdmin(toScopedActor(user), {
      ...(q.kind ? { kind: q.kind } : {}),
    });
    return { items };
  }

  @Roles('city_admin')
  @Get('/admin/curricula/:id/tree')
  async getTree(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    return this.service.getTree(toScopedActor(user), id);
  }

  @Roles('city_admin')
  @Post('/admin/curricula/:id/sections')
  @HttpCode(201)
  async addSection(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sectionSchema)) body: z.infer<typeof sectionSchema>,
  ) {
    return this.service.addSection(toScopedActor(user), id, body);
  }

  @Roles('city_admin')
  @Post('/admin/curricula/:id/items')
  @HttpCode(201)
  async addItem(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(itemSchema)) body: z.infer<typeof itemSchema>,
  ) {
    return this.service.addItem(toScopedActor(user), id, body);
  }

  @Roles('city_admin')
  @Post('/admin/curricula/:id/assign')
  @HttpCode(201)
  async assign(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignSchema)) body: z.infer<typeof assignSchema>,
  ) {
    return this.service.assign(toScopedActor(user), id, {
      centre_id: body.centre_id ?? null,
      batch_id: body.batch_id ?? null,
    });
  }

  @Roles('city_admin')
  @Post('/admin/curricula/:id/status')
  @HttpCode(200)
  async setStatus(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    return this.service.setStatus(toScopedActor(user), id, body.status);
  }

  @Roles('shikshak')
  @Post('/admin/students/:id/curriculum-progress')
  @HttpCode(200)
  async upsertProgress(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
    @Body(new ZodValidationPipe(progressSchema)) body: z.infer<typeof progressSchema>,
  ) {
    return this.service.upsertProgress(toScopedActor(user), studentId, body);
  }

  // ===========================================================================
  // Parent / student-view (read-only)
  // ===========================================================================

  @Get('/students/:id/curriculum-progress')
  async getStudentProgress(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
    @Query(new ZodValidationPipe(progressListQuery)) q: z.infer<typeof progressListQuery>,
  ) {
    return this.service.getStudentProgress(toScopedActor(user), studentId, q.curriculum_id);
  }
}
