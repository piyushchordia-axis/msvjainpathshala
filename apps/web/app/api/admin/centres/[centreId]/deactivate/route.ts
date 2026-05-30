/**
 * POST /api/admin/centres/[centreId]/deactivate
 *
 * Proxy for the centre deactivate action. Forwards to
 * POST /v1/centres/:id/deactivate (city_admin+). The backend rejects with 409
 * if the centre still owns active batches.
 */

import { NextResponse } from 'next/server';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ centreId: string }> },
): Promise<NextResponse> {
  const { centreId } = await ctx.params;
  const token = await readAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  try {
    const client = await authenticatedServerClient();
    await client.post(`/v1/centres/${centreId}/deactivate`, {});
    return NextResponse.json({ data: { ok: true } }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not deactivate centre' } },
      { status: 500 },
    );
  }
}
