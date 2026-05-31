export type Role =
  | 'super_admin'
  | 'state_admin'
  | 'city_admin'
  | 'sanchalak'
  | 'shikshak'
  | 'parent'
  | 'student'
  | 'guest';

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
  'super_admin',
  'state_admin',
  'city_admin',
  'sanchalak',
  'shikshak',
]);

export function canAccessAdminPanel(role: Role | undefined | null): boolean {
  return !!role && ADMIN_PANEL_ROLES.has(role);
}

export interface SessionUser {
  id: string;
  phone: string;
  role: Role;
  full_name: string;
  preferred_language: 'en' | 'hi';
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

const COOKIE_USER = 'jp_user';
const COOKIE_ACCESS = 'jp_access';

export function readSessionUserFromCookie(): SessionUser | null {
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_USER}=`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match.slice(COOKIE_USER.length + 1))) as SessionUser;
  } catch {
    return null;
  }
}

export function readAccessTokenFromCookie(): string | null {
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_ACCESS}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(COOKIE_ACCESS.length + 1));
}

export function clearSessionCookies(): void {
  for (const name of ['jp_access', 'jp_refresh', 'jp_user', 'jp_imp_origin', 'jp_imp_active']) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}
