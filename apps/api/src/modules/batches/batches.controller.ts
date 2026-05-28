/**
 * BatchesController — `/v1/centres/:centreId/batches` and `/v1/batches/:batchId/*`.
 *
 * Role gating: sanchalak+ for writes, any auth for reads. ScopeGuard enforces
 * "this centre is in my scope" for the centre-scoped routes via `@RequireScope`.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { BatchesService, type BatchActor } from './batches.service';

const ageGroup = z.enum(['bal', 'kishor', 'tarun', 'yuva']);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Time must be HH:MM[:SS]');

const createBatchSchema = z.object({
  name: z.string().min(1).max(200),
  age_group: ageGroup,
  capacity: z.number().int().min(1).max(500),
  // `schedule` is the API contract; internally we map it to the typed columns.
  schedule: z.object({
    days: z.array(z.number().int().min(1).max(7)).min(1),
    start_time: hhmm,
    end_time: hhmm,
  }),
  language_preference: z.string().min(1).max(40).optional(),
  academic_year: z.string().max(20).optional(),
});

const patchBatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  age_group: ageGroup.optional(),
  capacity: z.number().int().min(1).max(500).optional(),
  schedule: z
    .object({
      days: z.array(z.number().int().min(1).max(7)).min(1),
      start_time: hhmm,
      end_time: hhmm,
    })
    .partial()
    .optional(),
  language_preference: z.string().min(1).max(40).nullable().optional(),
  academic_year: z.string().max(20).optional(),
});

const assignShikshakSchema = z.object({
  user_id: z.string().uuid(),
});

function toActor(user: CurrentUserPayload | undefined): BatchActor {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
  return { user_id: user.sub, role: user.role };
}

@Controller()
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  // ---- by centre ---------------------------------------------------------

  @Get('/v1/centres/:centreId/batches')
  @RequireScope('centre', 'centreId')
  async listForCentre(@Param('centreId') centreId: string) {
    return { items: await this.batches.listForCentre(centreId) };
  }

  @Roles('sanchalak')
  @RequireScope('centre', 'centreId')
  @Post('/v1/centres/:centreId/batches')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('centreId') centreId: string,
    @Body(new ZodValidationPipe(createBatchSchema)) body: z.infer<typeof createBatchSchema>,
  ) {
    const input = {
      centre_id: centreId,
      name: body.name,
      age_group: body.age_group,
      capacity: body.capacity,
      day_of_week: body.schedule.days,
      start_time: body.schedule.start_time,
      end_time: body.schedule.end_time,
      ...(body.language_preference !== undefined
        ? { language_preference: body.language_preference }
        : {}),
      ...(body.academic_year !== undefined ? { academic_year: body.academic_year } : {}),
    };
    return this.batches.create(toActor(user), input);
  }

  // ---- by batch ----------------------------------------------------------

  @Get('/v1/batches/:batchId')
  @RequireScope('batch', 'batchId')
  async getOne(@Param('batchId') batchId: string) {
    return this.batches.getById(batchId);
  }

  @Roles('sanchalak')
  @RequireScope('batch', 'batchId')
  @Patch('/v1/batches/:batchId')
  async update(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('batchId') batchId: string,
    @Body(new ZodValidationPipe(patchBatchSchema)) body: z.infer<typeof patchBatchSchema>,
  ) {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch['name'] = body.name;
    if (body.age_group !== undefined) patch['age_group'] = body.age_group;
    if (body.capacity !== undefined) patch['capacity'] = body.capacity;
    if (body.schedule?.days !== undefined) patch['day_of_week'] = body.schedule.days;
    if (body.schedule?.start_time !== undefined) patch['start_time'] = body.schedule.start_time;
    if (body.schedule?.end_time !== undefined) patch['end_time'] = body.schedule.end_time;
    if (body.language_preference !== undefined)
      patch['language_preference'] = body.language_preference;
    if (body.academic_year !== undefined) patch['academic_year'] = body.academic_year;
    return this.batches.update(
      toActor(user),
      batchId,
      patch as Parameters<BatchesService['update']>[2],
    );
  }

  @Roles('sanchalak')
  @RequireScope('batch', 'batchId')
  @Post('/v1/batches/:batchId/deactivate')
  @HttpCode(204)
  async deactivate(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('batchId') batchId: string,
  ): Promise<void> {
    await this.batches.deactivate(toActor(user), batchId);
  }

  @Roles('sanchalak')
  @RequireScope('batch', 'batchId')
  @Post('/v1/batches/:batchId/shikshak-assignments')
  @HttpCode(201)
  async assignShikshak(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('batchId') batchId: string,
    @Body(new ZodValidationPipe(assignShikshakSchema))
    body: z.infer<typeof assignShikshakSchema>,
  ) {
    await this.batches.assignShikshak(toActor(user), batchId, body.user_id);
    return { batch_id: batchId, user_id: body.user_id, assigned: true };
  }

  @Roles('sanchalak')
  @RequireScope('batch', 'batchId')
  @Delete('/v1/batches/:batchId/shikshak-assignments/:userId')
  @HttpCode(204)
  async revokeShikshak(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('batchId') batchId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.batches.revokeShikshak(toActor(user), batchId, userId);
  }

  @Get('/v1/batches/:batchId/timetable')
  @RequireScope('batch', 'batchId')
  async timetable(@Param('batchId') batchId: string, @Query('weeks') weeks?: string) {
    const parsed = weeks ? Math.max(1, Math.min(52, parseInt(weeks, 10) || 8)) : 8;
    return { weeks: parsed, slots: await this.batches.timetable(batchId, parsed) };
  }
}

type _RoleAlias = Role;
