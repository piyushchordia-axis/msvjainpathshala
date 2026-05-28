/**
 * Auth endpoint wrappers used by Server Components and Route Handlers.
 *
 * Mirrors the shapes from the backend's auth controller (Step 5 + the
 * Step 8 PATCH /v1/auth/me extension).
 */

import { anonServerClient, withAccessToken } from './server-client';

import type { Role } from '@jp/shared';

export interface AuthUser {
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
  user: AuthUser;
  tokens: AuthTokens;
  default_view_context?: 'parent';
}

function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in (body as object)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export async function otpSend(phone: string): Promise<OtpSendResponse> {
  const res = await anonServerClient.post('/v1/auth/otp/send', { phone });
  return unwrap<OtpSendResponse>(res.data);
}

export async function otpVerify(input: {
  phone: string;
  code: string;
  device_id: string;
  platform: 'web';
}): Promise<OtpVerifyResponse> {
  const res = await anonServerClient.post('/v1/auth/otp/verify', {
    phone: input.phone,
    code: input.code,
    device: { device_id: input.device_id, platform: input.platform },
  });
  return unwrap<OtpVerifyResponse>(res.data);
}

export async function fetchMe(accessToken: string): Promise<AuthUser> {
  const res = await withAccessToken(accessToken).get('/v1/auth/me');
  // GET /v1/auth/me returns the user directly inside `data` (not nested).
  return unwrap<AuthUser>(res.data);
}

export async function callLogout(accessToken: string): Promise<void> {
  try {
    await withAccessToken(accessToken).post('/v1/auth/logout');
  } catch {
    // Best-effort; the cookie deletion proceeds regardless.
  }
}
