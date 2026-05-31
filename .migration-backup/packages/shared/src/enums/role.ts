/**
 * `role_enum` (SPEC §5.1) — the eight user roles in priority order.
 *
 * Hierarchical precedence (CLAUDE.md "Eight user roles"):
 *   super_admin > state_admin > city_admin > sanchalak > shikshak > parent > student > guest
 *
 * Note: `student` is not a separate login — it is a view context on the
 * parent's session (SPEC §7.5). Including it here matches the PG enum exactly.
 */

export const ROLES = [
  'super_admin',
  'state_admin',
  'city_admin',
  'sanchalak',
  'shikshak',
  'parent',
  'student',
  'guest',
] as const;

export type Role = (typeof ROLES)[number];

/** Numeric precedence — higher is more powerful. Used by RBAC guards. */
export const ROLE_PRECEDENCE: Record<Role, number> = {
  super_admin: 80,
  state_admin: 70,
  city_admin: 60,
  sanchalak: 50,
  shikshak: 40,
  parent: 30,
  student: 20,
  guest: 10,
};

export function roleAtLeast(actor: Role, required: Role): boolean {
  return ROLE_PRECEDENCE[actor] >= ROLE_PRECEDENCE[required];
}
