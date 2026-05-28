/**
 * GET /api/admin/socket-auth
 *
 * Server-side endpoint that hands the current admin's Socket.IO connection
 * a short-lived JWT + scope context. The browser can't read the httpOnly
 * `jp_access` cookie, so this handler does it for us, optionally calling
 * `/v1/auth/me` to enrich the response with the city_id needed to pick
 * the right `/admin-dashboard/:cityId` namespace.
 *
 * Used by the LiveActivityCard client component (Step 12).
 */

import { NextResponse } from 'next/server';

import { fetchMe } from '@/api/auth-endpoints';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

interface SocketAuthResponse {
  access_token: string;
  city_id: string | null;
  role: string;
  api_base_url: string;
}

const API_BASE_URL =
  (process.env.JP_API_BASE_URL?.replace(/\/$/, '') as string | undefined) ??
  'http://localhost:3000';

export async function GET(): Promise<NextResponse> {
  const token = await readAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  try {
    const me = await fetchMe(token);
    const body: SocketAuthResponse = {
      access_token: token,
      city_id: (me as { scope?: { city_id?: string }; city_id?: string }).scope?.city_id ?? null,
      role: (me as { role: string }).role,
      api_base_url: API_BASE_URL,
    };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 401 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'socket auth failed' } },
      { status: 500 },
    );
  }
}
