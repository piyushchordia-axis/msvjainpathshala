/**
 * DataExportController — parent self-service data export.
 *
 *   GET /v1/parents/me/data-export   parent (own account + children)
 *
 * The export is an auditable PII access, so a `data_export` audit row is
 * written on each call.
 */

import { Controller, Get } from '@nestjs/common';

import { AppError, ERROR_CODES } from '@jp/shared';

import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';

import { DataExportService } from './data-export.service';

@Controller('/v1/parents/me')
export class DataExportController {
  constructor(
    private readonly service: DataExportService,
    private readonly audit: AuditService,
  ) {}

  @Roles('parent')
  @Get('/data-export')
  async export(@CurrentUser() user: CurrentUserPayload | undefined) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    const data = await this.service.exportForParent(user.sub);
    await this.audit
      .emit({
        actor_user_id: user.sub,
        actor_role: user.role,
        action: 'data_export',
        entity_kind: 'user',
        entity_id: user.sub,
        after: { children: data.children.length, donations: data.donations.length },
      })
      .catch(() => undefined);
    return data;
  }
}
