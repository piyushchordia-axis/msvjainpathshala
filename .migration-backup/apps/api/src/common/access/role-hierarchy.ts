/**
 * Role hierarchy helpers (CLAUDE.md "Eight user roles").
 *
 * `ROLE_PRECEDENCE` is re-exported from `@jp/shared` to keep one source of
 * truth; the helper functions here let guards check satisfaction without
 * re-deriving it at every call site.
 */

import { ROLE_PRECEDENCE, roleAtLeast, type Role } from '@jp/shared';

export { ROLE_PRECEDENCE, roleAtLeast };
export type { Role };

/**
 * True when `actor` satisfies AT LEAST ONE of the required roles by
 * hierarchy (i.e. actor's precedence ≥ the lowest required role's
 * precedence). RolesGuard uses this.
 */
export function roleSatisfiesAny(actor: Role, required: readonly Role[]): boolean {
  if (required.length === 0) return true;
  const minimumRequired = required.reduce((min, r) =>
    ROLE_PRECEDENCE[r] < ROLE_PRECEDENCE[min] ? r : min,
  );
  return roleAtLeast(actor, minimumRequired);
}
