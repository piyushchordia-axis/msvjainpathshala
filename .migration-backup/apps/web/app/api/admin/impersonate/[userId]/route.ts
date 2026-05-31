/**
 * POST /api/admin/impersonate/[userId]
 *
 * super_admin only (backend enforces). Backs up the admin's current session,
 * calls the backend impersonation endpoint, and swaps the session cookies to
 * the impersonated token set. The original session is restored by
 * POST /api/admin/impersonate/stop. Two audit entries are written backend-side.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import {
  beginImpersonation,
  readAccessToken,
  readRefreshToken,
  readSessionUser,
} from '@/lib/auth-cookies';

import type { Role } from '@jp/shared';

const body = z.object({ reason: z.string().max(500).optional() });

interface ImpersonateResponse {
  user: {
    id: string;
    phone: string;
    role: Role;
    full_name?: string | null;
    preferred_language?: 'en' | 'hi';
  };
  tokens: {
    access_token: string;
    refresh_token: string;
    access_expires_at: string;
    refresh_expires_at: string;
  };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const { userId } = await ctx.params;
  const [token, originRefresh, originUser] = await Promise.all([
    readAccessToken(),
    readRefreshToken(),
    readSessionUser(),
  ]);
  if (!token || !originRefresh || !originUser) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }

  let parsed: z.infer<typeof body> = {};
  try {
    parsed = body.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION_FAILED', message: (err as Error).message } },
      { status: 422 },
    );
  }

  try {
    const client = await authenticatedServerClient();
    const res = await client.post(`/v1/admin/impersonate/${userId}`, { reason: parsed.reason });
    const data = res.data.data as ImpersonateResponse;
    await beginImpersonation({
      originRefresh,
      originUser,
      subject: {
        name: data.user.full_name || data.user.phone || 'user',
        role: data.user.role,
      },
      session: {
        access_token: data.tokens.access_token,
        refresh_token: data.tokens.refresh_token,
        access_expires_at: data.tokens.access_expires_at,
        refresh_expires_at: data.tokens.refresh_expires_at,
        user: {
          id: data.user.id,
          phone: data.user.phone,
          role: data.user.role,
          full_name: data.user.full_name ?? '',
          preferred_language: data.user.preferred_language ?? 'en',
        },
      },
    });
    return NextResponse.json({ data: { user: data.user } });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not start impersonation' } },
      { status: 500 },
    );
  }
}
