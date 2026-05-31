/**
 * AnalyticsController — SPEC §6.25.
 *
 *   GET /v1/admin/analytics/overview          sanchalak+ (scoped)
 *   GET /v1/admin/analytics/attendance        scoped
 *   GET /v1/admin/analytics/engagement        scoped
 *   GET /v1/admin/analytics/tier-distribution scoped
 *   GET /v1/admin/analytics/msv-pipeline      scoped
 *   GET /v1/admin/analytics/niyam-completion  scoped
 *   GET /v1/admin/analytics/donations         scoped
 */

import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ServiceRequestsRepository } from '../../db/repositories/service-requests.repository';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { AnalyticsService, type AnalyticsActor } from './analytics.service';

const rangeQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  months: z.coerce.number().int().min(1).max(24).optional(),
  financial_year: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

@Controller('/v1/admin/analytics')
export class AnalyticsController {
  constructor(
    private readonly service: AnalyticsService,
    private readonly serviceRequestsRepo: ServiceRequestsRepository,
  ) {}

  @Roles('sanchalak')
  @Get('/overview')
  async overview(@CurrentUser() user: CurrentUserPayload | undefined) {
    const actor = this.toActor(user);
    const overview = await this.service.overview(actor);
    if (actor.city_id) {
      const open = await this.serviceRequestsRepo.openCountByCity(actor.city_id);
      (overview as unknown as Record<string, number>).open_service_requests = open;
    }
    return overview;
  }

  @Roles('sanchalak')
  @Get('/attendance')
  async attendance(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
  ) {
    const items = await this.service.attendance(this.toActor(user), q.days);
    return { items };
  }

  @Roles('sanchalak')
  @Get('/engagement')
  async engagement(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
  ) {
    const items = await this.service.engagement(this.toActor(user), q.months);
    return { items };
  }

  @Roles('sanchalak')
  @Get('/tier-distribution')
  async tierDistribution(@CurrentUser() user: CurrentUserPayload | undefined) {
    const items = await this.service.tierDistribution(this.toActor(user));
    return { items };
  }

  @Roles('sanchalak')
  @Get('/msv-pipeline')
  async msvPipeline(@CurrentUser() user: CurrentUserPayload | undefined) {
    const items = await this.service.msvPipeline(this.toActor(user));
    return { items };
  }

  @Roles('sanchalak')
  @Get('/niyam-completion')
  async niyamCompletion(@CurrentUser() user: CurrentUserPayload | undefined) {
    const items = await this.service.niyamCompletion(this.toActor(user));
    return { items };
  }

  @Roles('sanchalak')
  @Get('/donations')
  async donations(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(rangeQuery)) q: z.infer<typeof rangeQuery>,
  ) {
    const items = await this.service.donationsSummary(
      this.toActor(user),
      q.financial_year ? { financial_year: q.financial_year } : {},
    );
    return { items };
  }

  // ---------------------------------------------------------------------

  private toActor(user: CurrentUserPayload | undefined): AnalyticsActor {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    const out: AnalyticsActor = { user_id: user.sub, role: user.role };
    if (user.scope.city_id) out.city_id = user.scope.city_id;
    if (user.scope.centre_ids) out.centre_ids = user.scope.centre_ids;
    return out;
  }
}
