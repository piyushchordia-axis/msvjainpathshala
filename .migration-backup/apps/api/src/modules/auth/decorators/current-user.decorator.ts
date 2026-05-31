/**
 * `@CurrentUser()` — parameter decorator that returns the JwtAuthGuard-
 * populated user record attached to the request.
 *
 * Shape matches `AccessTokenClaims` from JwtService (minus the JWT-specific
 * `iat` / `exp` / `iss` / `aud` claims).
 */

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { Role } from '@jp/shared';
import type { Request } from 'express';

export interface CurrentUserPayload {
  sub: string;
  role: Role;
  scope: { city_id?: string; centre_ids?: string[]; batch_ids?: string[] };
  view_context: 'parent' | 'student';
  view_student_id?: string;
  device_session_id: string;
  impersonator_id?: string;
  is_impersonation?: boolean;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUserPayload | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();
    return req.user;
  },
);
