/**
 * Auth domain re-exports.
 *
 * Types and the admin-panel gate come from the shared @workspace/api-zod
 * contracts (single source of truth, identical to the backend). Only
 * display-only helpers the backend doesn't define live here.
 */
export type {
  Role,
  SessionUser,
  AuthTokens,
  OtpSendResponse,
  OtpVerifyResponse,
} from "@workspace/api-zod";
export { canAccessAdminPanel, ADMIN_PANEL_ROLES } from "@workspace/api-zod";

import type { Role } from "@workspace/api-zod";

export const ROLE_PRECEDENCE: Record<Role, number> = {
  super_admin: 8,
  state_admin: 7,
  city_admin: 6,
  sanchalak: 5,
  shikshak: 4,
  parent: 3,
  student: 2,
  guest: 1,
};

/** Human-friendly role label, e.g. "super_admin" -> "Super Admin". */
export function roleLabel(role: Role | undefined | null): string {
  if (!role) return "Guest";
  return role
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
