/**
 * AdminBroadcastController — `POST /v1/admin/broadcasts` for super_admin /
 * state_admin / city_admin (SPEC §6.22).
 *
 * The broadcast is one fanout-job: workers split it per recipient.
 * `is_critical=true` triggers an SMS fan-out in addition to push/in-app
 * (subject to the per-user notification preferences and the monthly SMS
 * cap — see notification-sms.processor.ts).
 */

import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { NotificationsService } from './notifications.service';

const scopeSchema = z.object({
  kind: z.enum(['centre', 'city', 'state', 'national', 'role', 'msv_cohort', 'batch']),
  id: z.string().optional(),
  role: z.string().optional(),
});

const bodySchema = z.object({
  scope: scopeSchema,
  title_en: z.string().min(1).max(200),
  title_hi: z.string().min(1).max(200),
  body_en: z.string().min(1).max(2000),
  body_hi: z.string().min(1).max(2000),
  send_sms: z.boolean().default(false),
  is_critical: z.boolean().default(false),
});

@Controller('/v1/admin')
export class AdminBroadcastController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Roles('super_admin', 'state_admin', 'city_admin')
  @Post('/broadcasts')
  @HttpCode(202)
  async broadcast(
    @Body(new ZodValidationPipe(bodySchema)) body: z.infer<typeof bodySchema>,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    // Scope guard: only super_admin can post national/role/state. city_admin
    // can only post within their city / their centres.
    if (
      ['national', 'role', 'msv_cohort'].includes(body.scope.kind) &&
      user.role !== 'super_admin'
    ) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only super_admin can post a national/role/msv_cohort broadcast',
        statusCode: 403,
      });
    }
    if (body.scope.kind === 'state' && !['super_admin', 'state_admin'].includes(user.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'state-wide broadcasts are restricted to super_admin / state_admin',
        statusCode: 403,
      });
    }

    await this.notifications.enqueueFanout({
      event: body.is_critical ? 'notice.critical' : 'notice.published',
      scope: body.scope,
      data: {
        title: body.title_en,
        title_hi: body.title_hi,
        body: body.body_en,
        body_hi: body.body_hi,
      },
      send_sms: body.send_sms,
      is_critical: body.is_critical,
    });

    await this.audit
      .emit({
        actor_user_id: user.sub,
        actor_role: user.role,
        action: 'admin.broadcast',
        entity_kind: 'broadcast',
        entity_id: 'inline',
        after: {
          scope: body.scope,
          is_critical: body.is_critical,
          send_sms: body.send_sms,
        },
      })
      .catch(() => undefined);

    return { status: 'queued' };
  }
}
