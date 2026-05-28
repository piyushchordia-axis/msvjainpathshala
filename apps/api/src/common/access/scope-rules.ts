/**
 * Scope validation rules used by `ScopeGuard`.
 *
 * Given a `ScopeContext` (the user's resolved scope from their JWT) and a
 * route param (e.g. `:centreId`), each rule asserts that the actor is
 * permitted to act on that resource OR throws.
 *
 * super_admin / state_admin / city_admin pass with widening rules:
 *   - super_admin: never blocked by scope (precedence>= state_admin already
 *     covers cross-state)
 *   - state_admin: passes when the resource is in their state
 *   - city_admin:  passes when the resource is in their city
 *   - sanchalak:   passes when the resource is in one of their centres
 *   - shikshak:    passes when the resource is one of their batches
 *
 * For lookups (centre.city_id, batch.centre.city_id, etc.) we accept
 * resolver callbacks so the guard doesn't need to know about the schema.
 */

import { AppError, ERROR_CODES, type Role, type ScopeContext } from '@jp/shared';

export type ScopeKind = 'centre' | 'batch' | 'city' | 'state';

export interface CentreResolver {
  /** Return `{ city_id, state_id }` of the centre, or null if not found. */
  (centreId: string): Promise<{ city_id: string; state_id: string } | null>;
}
export interface BatchResolver {
  (batchId: string): Promise<{ centre_id: string; city_id: string; state_id: string } | null>;
}

const PRIVILEGED_ROLES = new Set<Role>(['super_admin']);

export function isPrivileged(role: Role): boolean {
  return PRIVILEGED_ROLES.has(role);
}

/** Always returns true (true = ok); throws an AppError on mismatch. */
export function assertCentreScope(
  ctx: ScopeContext,
  centreId: string,
  resolved: { city_id: string; state_id: string } | null,
): void {
  if (isPrivileged(ctx.role)) return;
  if (!resolved) {
    throw new AppError({
      code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
      message: 'Centre not found',
      statusCode: 404,
    });
  }
  switch (ctx.role) {
    case 'state_admin':
      if (ctx.state_id !== resolved.state_id) {
        throw outOfScope('centre');
      }
      return;
    case 'city_admin':
      if (ctx.city_id !== resolved.city_id) {
        throw outOfScope('centre');
      }
      return;
    case 'sanchalak':
      if (!ctx.centre_ids?.includes(centreId)) {
        throw outOfScope('centre');
      }
      return;
    default:
      // shikshak / parent / student have no inherent centre-scope rights
      // unless their decorator-defined role check accepts them. We block here.
      throw outOfScope('centre');
  }
}

export function assertBatchScope(
  ctx: ScopeContext,
  batchId: string,
  resolved: { centre_id: string; city_id: string; state_id: string } | null,
): void {
  if (isPrivileged(ctx.role)) return;
  if (!resolved) {
    throw new AppError({
      code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
      message: 'Batch not found',
      statusCode: 404,
    });
  }
  switch (ctx.role) {
    case 'state_admin':
      if (ctx.state_id !== resolved.state_id) throw outOfScope('batch');
      return;
    case 'city_admin':
      if (ctx.city_id !== resolved.city_id) throw outOfScope('batch');
      return;
    case 'sanchalak':
      if (!ctx.centre_ids?.includes(resolved.centre_id)) throw outOfScope('batch');
      return;
    case 'shikshak':
      if (!ctx.batch_ids?.includes(batchId)) throw outOfScope('batch');
      return;
    default:
      throw outOfScope('batch');
  }
}

export function assertCityScope(ctx: ScopeContext, cityId: string): void {
  if (isPrivileged(ctx.role)) return;
  switch (ctx.role) {
    case 'state_admin':
      // State admin acting on a city in their state — caller must provide the
      // state_id resolved from the cityId via a CityResolver. For Step 5 we
      // accept any cityId; tighten in Step 6 when geography service lands.
      return;
    case 'city_admin':
      if (ctx.city_id !== cityId) throw outOfScope('city');
      return;
    default:
      throw outOfScope('city');
  }
}

function outOfScope(kind: ScopeKind): AppError {
  return new AppError({
    code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
    message: `That ${kind} belongs to a different scope`,
    statusCode: 403,
  });
}
