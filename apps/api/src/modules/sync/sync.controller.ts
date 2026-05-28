/**
 * SyncController — `/v1/sync/{batch,bootstrap,delta}`.
 *
 *   POST /v1/sync/batch       — body validated by syncBatchSchema (≤200 ops)
 *   GET  /v1/sync/bootstrap   — full working set (Redis-cached 5 min)
 *   GET  /v1/sync/delta?since — same shape, filtered by updated_at
 *
 * Every route requires a valid JWT (global guard) but is open to ALL
 * authenticated roles — the per-op authorisation lives in each handler's
 * `allowed_roles` array.
 */

import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, syncBatchSchema, type SyncBatchDto } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';

import { SyncService } from './sync.service';

import type { ScopedActor } from '../attendance/attendance.service';

const deltaQuerySchema = z.object({
  since: z.string().datetime({ message: 'since must be an ISO-8601 datetime' }),
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

function requireUser(user: CurrentUserPayload | undefined): CurrentUserPayload {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
  return user;
}

@Controller('/v1/sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  // ---------------------------------------------------------------------------
  // POST /v1/sync/batch
  // ---------------------------------------------------------------------------

  @Post('/batch')
  @HttpCode(200)
  async batch(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(syncBatchSchema)) body: SyncBatchDto,
  ) {
    const u = requireUser(user);
    return this.service.applyBatch(toScopedActor(u), body.ops);
  }

  // ---------------------------------------------------------------------------
  // GET /v1/sync/bootstrap
  // ---------------------------------------------------------------------------

  @Get('/bootstrap')
  async bootstrap(@CurrentUser() user: CurrentUserPayload | undefined) {
    const u = requireUser(user);
    return this.service.bootstrap(toScopedActor(u));
  }

  // ---------------------------------------------------------------------------
  // GET /v1/sync/delta?since=ISO
  // ---------------------------------------------------------------------------

  @Get('/delta')
  async delta(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(deltaQuerySchema)) q: z.infer<typeof deltaQuerySchema>,
  ) {
    const u = requireUser(user);
    return this.service.delta(toScopedActor(u), new Date(q.since));
  }
}
