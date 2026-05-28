/**
 * ScopeGuard — enforces centre / batch / city scope on routes that declare
 * `@RequireScope(kind, paramName)`.
 *
 * Step 6 wires the real resolvers via CentresRepository / BatchesRepository.
 * Algorithm:
 *   1. Read @RequireScope metadata. If absent → pass through.
 *   2. Read the resource id from `req.params[paramName]`.
 *   3. Resolve `{ city_id, state_id, centre_id? }` via the matching repo.
 *   4. Apply the role-aware rule from `common/access/scope-rules.ts`.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError, ERROR_CODES, type ScopeContext } from '@jp/shared';

import {
  assertBatchScope,
  assertCentreScope,
  assertCityScope,
} from '../../../common/access/scope-rules';
import { BatchesRepository, CentresRepository } from '../../../db/repositories';
import { SCOPE_KEY, type ScopeMeta } from '../decorators/require-scope.decorator';

import type { CurrentUserPayload } from '../decorators/current-user.decorator';
import type { Request } from 'express';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly centres: CentresRepository,
    private readonly batches: BatchesRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<ScopeMeta | undefined>(SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUserPayload; params?: Record<string, string> }>();
    if (!req.user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }

    const paramValue = req.params?.[meta.paramName];
    if (!paramValue) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: `@RequireScope('${meta.kind}', '${meta.paramName}') but route param '${meta.paramName}' missing`,
        statusCode: 500,
      });
    }

    const ctx: ScopeContext = {
      user_id: req.user.sub,
      role: req.user.role,
      ...(req.user.scope.city_id ? { city_id: req.user.scope.city_id } : {}),
      ...(req.user.scope.centre_ids ? { centre_ids: req.user.scope.centre_ids } : {}),
      ...(req.user.scope.batch_ids ? { batch_ids: req.user.scope.batch_ids } : {}),
    };

    switch (meta.kind) {
      case 'centre': {
        const resolved = await this.centres.findScopeById(paramValue);
        assertCentreScope(ctx, paramValue, resolved);
        return true;
      }
      case 'batch': {
        const resolved = await this.batches.findScopeById(paramValue);
        assertBatchScope(ctx, paramValue, resolved);
        return true;
      }
      case 'city': {
        assertCityScope(ctx, paramValue);
        return true;
      }
      case 'state':
        // State scope is currently advisory (state_admin precedence handles it).
        return true;
    }
  }
}
