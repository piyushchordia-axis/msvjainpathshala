/**
 * JwtAuthGuard — bearer-token authentication.
 *
 *   • Reads `Authorization: Bearer <token>`.
 *   • Verifies via JwtService (current key first, then previous during
 *     rotation grace window).
 *   • Attaches `req.user` (CurrentUserPayload) for downstream guards +
 *     `@CurrentUser()`.
 *   • Enriches the AsyncLocalStorage `RequestContext` with `user_id`,
 *     `role`, and `impersonator_id` so every log line picks them up.
 *   • Honours `@Public()` to skip — the only opt-out.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError, ERROR_CODES } from '@jp/shared';

import { setContextFields } from '../../../common/context/request-context';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtService } from '../services/jwt.service';

import type { CurrentUserPayload } from '../decorators/current-user.decorator';
import type { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();
    const header = req.header('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Authorization header missing',
        statusCode: 401,
      });
    }
    const token = header.slice('bearer '.length).trim();
    if (!token) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Authorization header missing token',
        statusCode: 401,
      });
    }

    let claims;
    try {
      claims = await this.jwt.verifyAccess(token);
    } catch (err) {
      const expired = (err as Error).message?.includes('exp');
      throw new AppError({
        code: expired ? ERROR_CODES.ERR_AUTH_TOKEN_EXPIRED : ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: expired ? 'Your session has expired — please sign in again' : 'Token is invalid',
        statusCode: 401,
      });
    }

    const user: CurrentUserPayload = {
      sub: claims.sub,
      role: claims.role,
      scope: claims.scope ?? {},
      view_context: claims.view_context,
      ...(claims.view_student_id ? { view_student_id: claims.view_student_id } : {}),
      device_session_id: claims.device_session_id,
      ...(claims.impersonator_id ? { impersonator_id: claims.impersonator_id } : {}),
      ...(claims.is_impersonation ? { is_impersonation: true } : {}),
    };

    req.user = user;
    setContextFields({
      user_id: user.sub,
      role: user.role,
      ...(user.impersonator_id ? { impersonator_id: user.impersonator_id } : {}),
    });
    return true;
  }
}
