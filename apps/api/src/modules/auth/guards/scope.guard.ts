/**
 * ScopeGuard — enforces centre / batch / city scope on routes that declare
 * `@RequireScope(kind, paramName)`.
 *
 * For Step 5 we ship the guard skeleton + the simplest of resolvers
 * (no-op pass-through when no metadata is present). Step 6 lands the
 * centres / batches modules which provide the resolvers — at that point
 * we wire them via DI tokens and ScopeGuard becomes effective.
 *
 * Until then any route that declares @RequireScope without those modules
 * present will return ERR_NOT_IMPLEMENTED so the failure is loud rather
 * than silently letting requests through.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError, ERROR_CODES } from '@jp/shared';

import { SCOPE_KEY, type ScopeMeta } from '../decorators/require-scope.decorator';

import type { CurrentUserPayload } from '../decorators/current-user.decorator';
import type { Request } from 'express';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<ScopeMeta | undefined>(SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();
    if (!req.user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }

    // Resolution lands in Step 6 when CentresService / BatchesService can
    // tell us the city_id / state_id of the resource. Until then we fail
    // closed so misuse is loud.
    throw new AppError({
      code: ERROR_CODES.ERR_NOT_IMPLEMENTED,
      message: `Scope enforcement for '${meta.kind}' lands in Step 6`,
      statusCode: 501,
    });
  }
}
