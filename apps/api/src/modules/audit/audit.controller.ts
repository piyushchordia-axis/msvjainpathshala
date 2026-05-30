/**
 * AuditController — READ-side `/v1/admin/audit-logs`.
 *
 * The audit *write* path is INSERT-only via {@link AuditService} under the
 * `audit_writer` Postgres role. This controller exposes a paginated, newest-
 * first read of the append-only log for the admin web panel.
 *
 * Role gating: `@Roles('city_admin')` — city_admin and above (hierarchy-aware
 * RolesGuard). Scoping:
 *   - super_admin / state_admin → platform-wide feed (no city filter).
 *   - city_admin and below      → only entries whose actor user shares the
 *     requester's city (join via AuditLogsRepository).
 */

import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditLogsRepository } from '../../db/repositories/audit-logs.repository';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Roles that see the entire platform feed (no city scoping). */
const GLOBAL_ROLES: Role[] = ['super_admin', 'state_admin'];

@Controller('/v1/admin')
export class AuditController {
  constructor(private readonly repo: AuditLogsRepository) {}

  @Roles('city_admin')
  @Get('/audit-logs')
  async list(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }

    // super_admin / state_admin see everything; city_admin (and below, though
    // the @Roles gate already blocks below) are restricted to their own city.
    const cityId = GLOBAL_ROLES.includes(user.role) ? undefined : user.scope.city_id;

    const items = await this.repo.list({
      ...(cityId ? { cityId } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.offset ? { offset: q.offset } : {}),
    });

    return { items, page_size: items.length };
  }
}
