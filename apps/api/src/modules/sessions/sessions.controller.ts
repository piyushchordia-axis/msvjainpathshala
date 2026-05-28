/**
 * SessionsController — `/v1/sessions/*` (Step 13).
 *
 * Routes:
 *   GET   /v1/sessions/today                shikshak
 *   POST  /v1/sessions/check-in             shikshak (id-less; resolves today's session)
 *   POST  /v1/sessions/:id/check-in         shikshak (SPEC primary)
 *   POST  /v1/sessions/:id/check-out        shikshak
 *   POST  /v1/sessions/:id/cancel           shikshak / sanchalak+ / city_admin+
 *   GET   /v1/sessions                      authenticated (filters)
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { SessionsService, type ScopedActor } from './sessions.service';

const checkInBodySchema = z.object({
  batch_id: z.string().uuid().optional(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  accuracy_m: z.number().nonnegative(),
  client_op_id: z.string().min(8).max(64),
});

const checkOutBodySchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  client_op_id: z.string().min(8).max(64),
});

const cancelBodySchema = z.object({
  reason: z.string().min(10).max(500),
});

const listQuerySchema = z.object({
  batch_id: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function toScopedActor(user: CurrentUserPayload): ScopedActor {
  return {
    user_id: user.sub,
    role: user.role,
    city_id: user.scope.city_id,
    centre_ids: user.scope.centre_ids,
    batch_ids: user.scope.batch_ids,
  };
}

function assertActor(user: CurrentUserPayload | undefined): asserts user is CurrentUserPayload {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
}

@Controller('/v1/sessions')
export class SessionsController {
  constructor(private readonly service: SessionsService) {}

  // ---------------------------------------------------------------------------
  // Today
  // ---------------------------------------------------------------------------

  @Roles('shikshak')
  @Get('/today')
  async today(@CurrentUser() user: CurrentUserPayload | undefined) {
    assertActor(user);
    return this.service.today(toScopedActor(user));
  }

  // ---------------------------------------------------------------------------
  // Check-in (id-less convenience + id-bound SPEC primary)
  // ---------------------------------------------------------------------------

  @Roles('shikshak')
  @Post('/check-in')
  @HttpCode(200)
  async checkInByBatch(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(checkInBodySchema)) body: z.infer<typeof checkInBodySchema>,
  ) {
    assertActor(user);
    if (!body.batch_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'batch_id is required on the id-less check-in path',
        statusCode: 422,
      });
    }
    return this.service.checkIn(toScopedActor(user), {
      batch_id: body.batch_id,
      lat: body.lat,
      lng: body.lng,
      accuracy_m: body.accuracy_m,
      client_op_id: body.client_op_id,
    });
  }

  @Roles('shikshak')
  @Post('/:id/check-in')
  @HttpCode(200)
  async checkInById(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checkInBodySchema)) body: z.infer<typeof checkInBodySchema>,
  ) {
    assertActor(user);
    return this.service.checkIn(toScopedActor(user), {
      session_id: id,
      lat: body.lat,
      lng: body.lng,
      accuracy_m: body.accuracy_m,
      client_op_id: body.client_op_id,
    });
  }

  // ---------------------------------------------------------------------------
  // Check-out
  // ---------------------------------------------------------------------------

  @Roles('shikshak')
  @Post('/:id/check-out')
  @HttpCode(200)
  async checkOut(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checkOutBodySchema)) body: z.infer<typeof checkOutBodySchema>,
  ) {
    assertActor(user);
    return this.service.checkOut(toScopedActor(user), id, body);
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  @Roles('shikshak')
  @Post('/:id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelBodySchema)) body: z.infer<typeof cancelBodySchema>,
  ) {
    assertActor(user);
    return this.service.cancel(toScopedActor(user), id, body.reason);
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  @Roles('shikshak')
  @Get('/')
  async list(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    assertActor(user);
    const items = await this.service.list({
      ...(q.batch_id ? { batch_id: q.batch_id } : {}),
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.offset ? { offset: q.offset } : {}),
    });
    return { items, page_size: items.length };
  }
}
