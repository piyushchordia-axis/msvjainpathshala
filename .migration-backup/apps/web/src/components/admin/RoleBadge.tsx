/**
 * RoleBadge — renders the user's role with role-appropriate styling.
 * Used in the admin top bar and audit log surfaces.
 *
 * Display names follow CLAUDE.md "Eight user roles":
 *   shikshak → "Guruji" (display name; the role enum stays `shikshak`)
 *   sanchalak → "Sanchalak"
 *   etc.
 */

import { Badge } from '@/components/ui/badge';

import type { Role } from '@jp/shared';

const ROLE_DISPLAY: Record<Role, string> = {
  super_admin: 'Super admin',
  state_admin: 'State admin',
  city_admin: 'City admin',
  sanchalak: 'Sanchalak',
  shikshak: 'Guruji',
  parent: 'Parent',
  student: 'Student',
  guest: 'Guest',
};

const ROLE_VARIANT: Record<Role, 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'default'> =
  {
    super_admin: 'error',
    state_admin: 'warning',
    city_admin: 'info',
    sanchalak: 'success',
    shikshak: 'default',
    parent: 'neutral',
    student: 'neutral',
    guest: 'neutral',
  };

export function RoleBadge({ role }: { role: Role }) {
  return <Badge variant={ROLE_VARIANT[role]}>{ROLE_DISPLAY[role]}</Badge>;
}
