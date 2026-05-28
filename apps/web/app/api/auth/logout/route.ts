/**
 * POST /api/auth/logout
 *
 * Calls the backend `POST /v1/auth/logout` (best-effort, ignores any
 * 401 from an already-expired access token) and clears the three
 * session cookies. Returns 204 either way.
 */

import { NextResponse } from 'next/server';

import { callLogout } from '@/api/auth-endpoints';
import { clearSessionCookies, readAccessToken } from '@/lib/auth-cookies';

export async function POST(): Promise<NextResponse> {
  const token = await readAccessToken();
  if (token) {
    await callLogout(token).catch(() => undefined);
  }
  await clearSessionCookies();
  return new NextResponse(null, { status: 204 });
}
