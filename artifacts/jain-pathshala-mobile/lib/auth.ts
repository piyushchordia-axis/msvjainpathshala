/**
 * Auth domain types — mirrored from the web artifact (src/lib/auth.ts).
 * Cookie helpers are web-only and intentionally omitted; the mobile app
 * persists the session via AsyncStorage in contexts/AuthContext.tsx.
 */

export type Role =
  | "super_admin"
  | "state_admin"
  | "city_admin"
  | "sanchalak"
  | "shikshak"
  | "parent"
  | "student"
  | "guest";

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

export const ADMIN_PANEL_ROLES = new Set<Role>([
  "super_admin",
  "state_admin",
  "city_admin",
  "sanchalak",
  "shikshak",
]);

export function canAccessAdminPanel(role: Role | undefined | null): boolean {
  return !!role && ADMIN_PANEL_ROLES.has(role);
}

export function roleLabel(role: Role | undefined | null): string {
  if (!role) return "Guest";
  return role
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export interface SessionUser {
  id: string;
  phone: string;
  role: Role;
  full_name: string;
  preferred_language: "en" | "hi";
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
}

export interface OtpSendResponse {
  otp_token: string;
  expires_in_seconds: number;
}

export interface OtpVerifyResponse {
  user: SessionUser;
  tokens: AuthTokens;
}
