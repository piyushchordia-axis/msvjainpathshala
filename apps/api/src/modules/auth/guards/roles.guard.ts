/**
 * RolesGuard — asserts the actor's role satisfies one of the `@Roles(...)`
 * required roles by hierarchy.
 *
 * Runs AFTER JwtAuthGuard. If no @Roles metadata is set, allows through
 * (the route is open to any authenticated user).
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { roleSatisfiesAny } from '../../../common/access/role-hierarchy';
import { ROLES_KEY } from '../decorators/roles.decorator';

import type { CurrentUserPayload } from '../decorators/current-user.decorator';
import type { Request } from 'express';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();
    const user = req.user;
    if (!user) {
      // JwtAuthGuard should have caught this; defensive check.
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }

    if (!roleSatisfiesAny(user.role, required)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: "You don't have permission to do that",
        statusCode: 403,
      });
    }
    return true;
  }
}
