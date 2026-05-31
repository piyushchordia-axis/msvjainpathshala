/**
 * POST /api/admin/impersonate/stop
 *
 * Ends an impersonation session and restores the original admin session.
 * We refresh the backed-up admin refresh token to mint a fresh, valid access
 * token (the original access token may have expired during impersonation),
 * then redirect back to where the Stop button was pressed.
 */

import { NextResponse } from 'next/server';

import { anonServerClient } from '@/api/server-client';
import { endImpersonation, readImpersonationOrigin, setSessionCookies } from '@/lib/auth-cookies';

interface RefreshTokens {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const origin = await readImpersonationOrigin();
  await endImpersonation();

  if (origin) {
    try {
      const res = await anonServerClient.post('/v1/auth/refresh', {
        refresh_token: origin.refresh,
      });
      const t = res.data.data as RefreshTokens;
      await setSessionCookies({ ...t, user: origin.user });
    } catch {
      // If the refresh fails the admin will simply be asked to sign in again.
    }
  }

  const referer = req.headers.get('referer');
  const target = referer ?? new URL('/', req.url).toString();
  return NextResponse.redirect(target, { status: 303 });
}
