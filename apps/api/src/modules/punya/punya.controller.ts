/**
 * PunyaController — `/v1/students/:id/punya/*`, `/v1/punya/*`, `/v1/leaderboards/*`,
 * `/v1/admin/punya/*` (SPEC §6.9).
 *
 * Endpoint surface (Step 16):
 *
 *   GET    /v1/students/:id/punya/balance        parent (own) / student-view /
 *                                                shikshak (own) / sanchalak+
 *   GET    /v1/students/:id/punya/transactions   same
 *   GET    /v1/students/:id/punya/tier-progress  same
 *
 *   POST   /v1/punya/award                       sanchalak+ / shikshak (own batch)
 *   POST   /v1/admin/punya/manual-award          alias of /v1/punya/award (SPEC §6.9)
 *   POST   /v1/punya/reverse                     sanchalak+ — 30-day window (Q5)
 *
 *   GET    /v1/leaderboards/:scope               any auth — caches 60s @ edge
 *   GET    /v1/leaderboard                       legacy querystring form (?scope&id)
 *
 *   GET    /v1/admin/punya/features              super_admin / city_admin (read)
 *   POST   /v1/admin/punya/configs               city_admin
 *
 *   POST   /v1/admin/punya/reconcile             super_admin — manual run of the
 *                                                nightly reconciliation
 *
 * The `@Roles(min)` decorator does the coarse gate; service-layer scope
 * checks enforce per-student / per-city boundaries.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PunyaFeaturesRepository } from '../../db/repositories';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { LeaderboardService } from './leaderboard.service';
import { PunyaReconcileService } from './punya-reconcile.service';
import { PunyaService, type ScopedActor } from './punya.service';
import { LEADERBOARD_SCOPES, type LeaderboardScope } from './punya.types';

const manualAwardSchema = z.object({
  student_id: z.string().uuid(),
  feature_key: z.string().min(1).max(64),
  points: z.number().int().min(-500).max(500),
  reason: z.string().min(3).max(500),
  is_msv_track: z.boolean().optional(),
});

const reverseSchema = z.object({
  source_id: z.string().uuid(),
  reason: z.string().min(3).max(500),
  idempotency_key: z.string().min(8).max(96).optional(),
});

const transactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().datetime().optional(),
});

const leaderboardQuerySchema = z.object({
  scope_id: z.string().uuid().optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** Optional student_id used to anchor `self_rank` for shikshak/admin views. */
  for_student_id: z.string().uuid().optional(),
});

const leaderboardLegacyQuerySchema = z.object({
  scope: z.enum(['batch', 'centre', 'city', 'national', 'msv']),
  id: z.string().uuid().optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const configUpsertSchema = z.object({
  city_id: z.string().uuid(),
  feature_id: z.string().uuid(),
  points_override: z.number().int().min(-500).max(500),
  min_points: z.number().int().optional(),
  max_points: z.number().int().optional(),
});

function toScopedActor(user: CurrentUserPayload | undefined): ScopedActor {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
  const out: ScopedActor = {
    user_id: user.sub,
    role: user.role,
  };
  if (user.scope.city_id) out.city_id = user.scope.city_id;
  if (user.scope.centre_ids) out.centre_ids = user.scope.centre_ids;
  if (user.scope.batch_ids) out.batch_ids = user.scope.batch_ids;
  return out;
}

@Controller('/v1')
export class PunyaController {
  constructor(
    private readonly service: PunyaService,
    private readonly leaderboard: LeaderboardService,
    private readonly features: PunyaFeaturesRepository,
    private readonly reconcile: PunyaReconcileService,
  ) {}

  // ===========================================================================
  // Reads — balance / transactions / tier progress
  // ===========================================================================

  @Get('/students/:id/punya/balance')
  async balance(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
  ) {
    return this.service.getBalance(toScopedActor(user), studentId);
  }

  @Get('/students/:id/punya/transactions')
  async transactions(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
    @Query(new ZodValidationPipe(transactionsQuerySchema))
    q: z.infer<typeof transactionsQuerySchema>,
  ) {
    return this.service.getTransactions(toScopedActor(user), studentId, q);
  }

  @Get('/students/:id/punya/tier-progress')
  async tierProgress(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
  ) {
    return this.service.getTierProgress(toScopedActor(user), studentId);
  }

  // ===========================================================================
  // Manual award + reversal
  // ===========================================================================

  @Roles('shikshak')
  @Post('/punya/award')
  @HttpCode(201)
  async award(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(manualAwardSchema)) body: z.infer<typeof manualAwardSchema>,
  ) {
    return this.service.manualAward(toScopedActor(user), body);
  }

  /** SPEC alias `/admin/punya/manual-award` for symmetry with §6.9. */
  @Roles('shikshak')
  @Post('/admin/punya/manual-award')
  @HttpCode(201)
  async adminAward(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(manualAwardSchema)) body: z.infer<typeof manualAwardSchema>,
  ) {
    return this.service.manualAward(toScopedActor(user), body);
  }

  @Roles('sanchalak')
  @Post('/punya/reverse')
  @HttpCode(201)
  async reverse(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(reverseSchema)) body: z.infer<typeof reverseSchema>,
  ) {
    return this.service.reverseTransaction(toScopedActor(user), {
      source_id: body.source_id,
      reason: body.reason,
      idempotency_key: body.idempotency_key ?? `reverse:${body.source_id}`,
    });
  }

  // ===========================================================================
  // Leaderboards
  // ===========================================================================

  @Get('/leaderboards/:scope')
  async leaderboards(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('scope') scope: string,
    @Query(new ZodValidationPipe(leaderboardQuerySchema))
    q: z.infer<typeof leaderboardQuerySchema>,
  ) {
    const s = scope as LeaderboardScope;
    if (!LEADERBOARD_SCOPES.includes(s)) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: `Unknown leaderboard scope: ${scope}`,
        statusCode: 422,
      });
    }
    const actor = toScopedActor(user);
    return this.leaderboard.read({
      actor,
      scope: s,
      ...(q.scope_id ? { scope_id: q.scope_id } : {}),
      ...(q.period ? { period: q.period } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.for_student_id ? { for_student_id: q.for_student_id } : {}),
    });
  }

  /** Legacy `?scope=&id=` form referenced in SPEC §6.9. */
  @Get('/leaderboard')
  async leaderboardLegacy(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(leaderboardLegacyQuerySchema))
    q: z.infer<typeof leaderboardLegacyQuerySchema>,
  ) {
    const actor = toScopedActor(user);
    return this.leaderboard.read({
      actor,
      scope: q.scope,
      ...(q.id ? { scope_id: q.id } : {}),
      ...(q.period ? { period: q.period } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
  }

  // ===========================================================================
  // Configs (city_admin) + features (read)
  // ===========================================================================

  @Get('/admin/punya/features')
  @Roles('city_admin')
  async listFeatures() {
    return { items: await this.features.listFeatures() };
  }

  @Get('/admin/punya/configs/:cityId')
  @Roles('city_admin')
  async listConfigs(@Param('cityId') cityId: string) {
    return { items: await this.features.listConfigsForCity(cityId) };
  }

  @Post('/admin/punya/configs')
  @Roles('city_admin')
  @HttpCode(201)
  async upsertConfig(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(configUpsertSchema)) body: z.infer<typeof configUpsertSchema>,
  ) {
    const actor = toScopedActor(user);
    // Scope check: city_admin can only configure their own city.
    if (
      actor.role !== 'super_admin' &&
      actor.role !== 'state_admin' &&
      actor.city_id !== body.city_id
    ) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'You can only configure Punya for your own city',
        statusCode: 403,
      });
    }
    // Bounds check vs super_admin-set feature envelope.
    const feature = await this.features.findFeatureById(body.feature_id);
    if (!feature) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_INVALID_FEATURE,
        message: 'Punya feature not found',
        statusCode: 404,
      });
    }
    const min = feature.min_points ?? Number.NEGATIVE_INFINITY;
    const max = feature.max_points ?? Number.POSITIVE_INFINITY;
    if (body.points_override < min || body.points_override > max) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_CONFIG_OUT_OF_BOUNDS,
        message: `points_override outside super_admin envelope [${min}..${max}]`,
        statusCode: 422,
      });
    }
    const row = await this.features.upsertConfig({
      city_id: body.city_id,
      feature_id: body.feature_id,
      points_override: body.points_override,
      ...(body.min_points !== undefined ? { min_points: body.min_points } : {}),
      ...(body.max_points !== undefined ? { max_points: body.max_points } : {}),
    });
    return row;
  }

  // ===========================================================================
  // Reconciliation
  // ===========================================================================

  @Roles('super_admin')
  @Post('/admin/punya/reconcile')
  async runReconcile() {
    return this.reconcile.runOnce({ source: 'manual_admin' });
  }

  @Roles('city_admin')
  @Get('/admin/punya/reconcile/last-run')
  async lastReconcile() {
    return this.reconcile.getLastRun();
  }
}
