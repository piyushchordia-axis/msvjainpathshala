/**
 * ImpersonationService — super_admin acting as another user.
 *
 *   • Only super_admin may call (enforced in the controller).
 *   • Mints a short-lived access token (TTL from system_config) carrying
 *     `is_impersonation=true` + `impersonator_id=<super_admin_id>`.
 *   • CLAUDE.md "Authentication rules → Admin impersonation": writes
 *     TWO audit entries — one for the impersonator's action ("started
 *     impersonating") and one anchored to the target ("was impersonated").
 *     Every subsequent business action carries `impersonator_id` so
 *     CLAUDE.md's "all actions during impersonation carry impersonator_id"
 *     rule is satisfied by the access token claim flowing through the
 *     RequestContext.
 */

import { Injectable } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { SystemConfigService } from '../../../core/system-config/system-config.service';
import { UsersRepository } from '../../../db/repositories';
import { AuditService } from '../../audit/audit.service';

import { JwtService } from './jwt.service';

@Injectable()
export class ImpersonationService {
  constructor(
    private readonly users: UsersRepository,
    private readonly config: SystemConfigService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async impersonate(input: {
    actorUserId: string;
    actorRole: Role;
    targetUserId: string;
    reason?: string;
    requestId?: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ access_token: string; expires_in_seconds: number }> {
    if (input.actorRole !== 'super_admin') {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_IMPERSONATION_DENIED,
        message: 'Only super admins can impersonate other users',
        statusCode: 403,
      });
    }

    const target = await this.users.findById(input.targetUserId);
    if (!target) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Target user not found',
        statusCode: 404,
      });
    }

    const ttlMinutes = await this.config.getNumber('impersonation.ttl_minutes');
    const ttlSeconds = ttlMinutes * 60;

    const accessToken = await this.jwt.signAccess(
      {
        sub: target.id,
        role: target.role as Role,
        scope: {},
        view_context: 'parent',
        device_session_id: 'impersonation', // sentinel — no real device session
        jti: crypto.randomUUID(),
        impersonator_id: input.actorUserId,
        is_impersonation: true,
      },
      ttlSeconds,
    );

    // TWO audit entries (CLAUDE.md): one for the actor's action, one for
    // the target's view-of-it. Same payload body, different anchor.
    const baseAfter = {
      target_user_id: target.id,
      impersonator_id: input.actorUserId,
      reason: input.reason ?? null,
      ttl_seconds: ttlSeconds,
    };
    await this.audit.emit({
      actor_user_id: input.actorUserId,
      actor_role: input.actorRole,
      action: 'auth.impersonation.started',
      entity_kind: 'user',
      entity_id: target.id,
      after: baseAfter,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      request_id: input.requestId ?? null,
    });
    await this.audit.emit({
      actor_user_id: target.id,
      actor_role: target.role as Role,
      action: 'auth.impersonation.subject_recorded',
      entity_kind: 'user',
      entity_id: target.id,
      after: baseAfter,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      request_id: input.requestId ?? null,
    });

    return { access_token: accessToken, expires_in_seconds: ttlSeconds };
  }
}
