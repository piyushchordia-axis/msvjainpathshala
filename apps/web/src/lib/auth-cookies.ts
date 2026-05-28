/**
 * Cookie helpers for the admin session.
 *
 * The web admin doesn't ask the backend to set cookies (the backend's
 * mobile-first auth contract returns tokens as JSON). Instead, our
 * Next.js Route Handlers proxy the OTP flow, then drop the JWT pair
 * into HTTP-only cookies. The middleware checks `JP_SESSION` for the
 * access token + decoded payload; refresh happens server-side via the
 * same Route Handler when the access token expires.
 *
 * Cookie set:
 *   - jp_access   — access token JWT (HTTP-only, SameSite=Lax)
 *   - jp_refresh  — refresh token JWT (HTTP-only, SameSite=Lax)
 *   - jp_user     — minimal user snapshot for UI hydration
 *                   (HTTP-only false so client components can read it)
 *
 * Access TTL drives `maxAge`; the refresh cookie outlives the access
 * cookie so a stale tab can still refresh on next request.
 */

import { cookies } from 'next/headers';

import type { Role } from '@jp/shared';

export const COOKIE_ACCESS = 'jp_access';
export const COOKIE_REFRESH = 'jp_refresh';
export const COOKIE_USER = 'jp_user';

export interface SessionUser {
  id: string;
  phone: string;
  role: Role;
  full_name: string;
  preferred_language: 'en' | 'hi';
}

interface SetSessionInput {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
  user: SessionUser;
}

function secondsUntil(iso: string): number {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 60 * 60; // fallback 1h
  return Math.max(60, Math.floor((target - Date.now()) / 1000));
}

export async function setSessionCookies(input: SetSessionInput): Promise<void> {
  const jar = await cookies();
  const isProd = process.env.NODE_ENV === 'production';
  const common = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
  };
  jar.set(COOKIE_ACCESS, input.access_token, {
    ...common,
    maxAge: secondsUntil(input.access_expires_at),
  });
  jar.set(COOKIE_REFRESH, input.refresh_token, {
    ...common,
    maxAge: secondsUntil(input.refresh_expires_at),
  });
  jar.set(COOKIE_USER, JSON.stringify(input.user), {
    ...common,
    httpOnly: false, // client components hydrate the header from this
    maxAge: secondsUntil(input.refresh_expires_at),
  });
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  for (const name of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_USER]) {
    jar.delete(name);
  }
}

export async function readSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_USER)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export async function readAccessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_ACCESS)?.value ?? null;
}
