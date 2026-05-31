/**
 * StudentsController — `/v1/students/*` + `/v1/parents/me/students` (Step 10).
 *
 * Notes:
 *   - GET /v1/parents/me/students returns the parent's children
 *     INCLUDING inactive (the parent needs visibility into deactivations
 *     so they can ask for reactivation).
 *   - PATCH allows the parent to edit `full_name`, `father_name`,
 *     `profile_photo_asset_id`, and `student_view_enabled`. Centre /
 *     batch changes go via `/v1/enrolments/students/:id/transfer`.
 *   - POST :id/deactivate flips `status='inactive'` + `deactivated_at`.
 *     This is irreversible only by `:id/reactivate`. Never DELETE (Q11).
 */

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { StudentsService, type ScopedActor } from './students.service';

const updateSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  father_name: z.string().max(200).nullable().optional(),
  profile_photo_asset_id: z.string().uuid().nullable().optional(),
  student_view_enabled: z.boolean().optional(),
});

const deactivateSchema = z.object({
  reason: z.string().min(1).max(500),
});

const listQuerySchema = z.object({
  centre_id: z.string().uuid().optional(),
  batch_id: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function assertActor(user: CurrentUserPayload | undefined): asserts user is CurrentUserPayload {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
}

function toScopedActor(user: CurrentUserPayload): ScopedActor {
  return {
    user_id: user.sub,
    role: user.role,
    city_id: user.scope.city_id,
    centre_ids: user.scope.centre_ids,
    batch_ids: user.scope.batch_ids,
    ...(user.view_context ? { view_context: user.view_context } : {}),
    ...(user.view_student_id ? { view_student_id: user.view_student_id } : {}),
  };
}

@Controller('/v1')
export class StudentsController {
  constructor(private readonly service: StudentsService) {}

  // Digital ID card -----------------------------------------------------------

  @Roles('parent')
  @Get('/students/:id/id-card')
  async getIdCard(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    assertActor(user);
    return this.service.getIdCard(toScopedActor(user), id);
  }

  @Roles('sanchalak')
  @Post('/admin/students/:id/id-card')
  @HttpCode(200)
  async regenerateIdCard(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
  ) {
    assertActor(user);
    return this.service.regenerateIdCard(toScopedActor(user), id);
  }

  // ---- Parent's own children -----------------------------------------
  @Get('/parents/me/students')
  async myChildren(@CurrentUser() user: CurrentUserPayload | undefined) {
    assertActor(user);
    const items = await this.service.listForParent(user.sub);
    return { items };
  }

  // ---- Admin / shikshak list + detail --------------------------------
  @Roles('shikshak')
  @Get('/students')
  async list(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    assertActor(user);
    const items = await this.service.listForActor(toScopedActor(user), {
      ...(q.centre_id ? { centre_id: q.centre_id } : {}),
      ...(q.batch_id ? { batch_id: q.batch_id } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.offset ? { offset: q.offset } : {}),
    });
    return { items, page_size: items.length };
  }

  @Get('/students/:id')
  async getOne(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    assertActor(user);
    return this.service.getById(toScopedActor(user), id);
  }

  // ---- Update (parent for own child, sanchalak+ otherwise) -----------
  @Patch('/students/:id')
  async update(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    assertActor(user);
    return this.service.update(toScopedActor(user), id, body);
  }

  // ---- Deactivate / Reactivate (sanchalak+) --------------------------
  @Roles('sanchalak')
  @Post('/students/:id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deactivateSchema)) body: z.infer<typeof deactivateSchema>,
  ) {
    assertActor(user);
    return this.service.deactivate(toScopedActor(user), id, body.reason);
  }

  @Roles('sanchalak')
  @Post('/students/:id/reactivate')
  @HttpCode(200)
  async reactivate(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    assertActor(user);
    return this.service.reactivate(toScopedActor(user), id);
  }
}
