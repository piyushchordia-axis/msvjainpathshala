/**
 * Role gating for /admin routes.
 *
 * Per SPEC §7 the high-to-low role chain is:
 *   super_admin → state_admin → city_admin → sanchalak → shikshak → parent → student → guest
 *
 * "Admin panel" access in Step 9 is restricted to roles that have any
 * administrative responsibility — everyone above (and including)
 * `shikshak` can sign in to the admin panel. `parent`, `student`,
 * `guest` get redirected to the public homepage.
 *
 * Per-route gates land per-feature step (e.g. `super_admin` only for
 * the queues dashboard from Step 7).
 */

import type { Role } from '@jp/shared';

export const ADMIN_PANEL_ROLES = new Set<Role>([
  'super_admin',
  'state_admin',
  'city_admin',
  'sanchalak',
  'shikshak',
]);

export function canAccessAdminPanel(role: Role | undefined | null): boolean {
  return !!role && ADMIN_PANEL_ROLES.has(role);
}
