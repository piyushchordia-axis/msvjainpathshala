/**
 * `ScopeContext` — the resolved tenant scope an actor is operating within.
 *
 * The `ScopeGuard` in `apps/api` populates this from the caller's role and
 * (where relevant) the resource being touched. Service-layer code reads it
 * to add WHERE filters that prevent cross-tenant leakage.
 *
 * Example: a city_admin acting in city `chennai` cannot see centres in
 * `mumbai` even if they call the centres endpoint directly — the scope
 * context enforces `centre.city_id = scope.city_id`.
 */

import type { Role } from '../enums/role.js';

export interface ScopeContext {
  /** Actor's role (after any student-view switch resolution). */
  role: Role;

  /** Authenticated user id. */
  user_id: string;

  /**
   * If the request is happening under super-admin impersonation, the original
   * super_admin's id. Every audited write carries this through.
   */
  impersonator_id?: string;

  /**
   * For parent acting in student-view context, the resolved student_id whose
   * view they are currently in (CLAUDE.md Q4).
   */
  view_student_id?: string;

  /** State the actor is scoped to, if applicable. */
  state_id?: string;

  /** City the actor is scoped to, if applicable. */
  city_id?: string;

  /** Centres the actor is scoped to (sanchalak may run multiple). */
  centre_ids?: string[];

  /** Batches the actor is scoped to (shikshak may run multiple). */
  batch_ids?: string[];
}

/** Branded type for idempotency keys (Punya transactions, sync ops, etc.). */
export type IdempotencyKey = string & { readonly __brand: 'IdempotencyKey' };

export function asIdempotencyKey(value: string): IdempotencyKey {
  return value as IdempotencyKey;
}
