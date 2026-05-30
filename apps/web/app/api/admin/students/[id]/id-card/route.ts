/**
 * POST /api/admin/students/[id]/id-card
 *
 * Regenerate a student's digital ID card. Proxies to
 * POST /v1/admin/students/:id/id-card (sanchalak+) and returns { card, url }
 * where url is a signed download URL for the freshly-rendered PDF.
 */

import { NextResponse } from 'next/server';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const token = await readAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }

  try {
    const client = await authenticatedServerClient();
    const res = await client.post(`/v1/admin/students/${id}/id-card`, {});
    return NextResponse.json({ data: res.data?.data ?? res.data }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not generate ID card' } },
      { status: 500 },
    );
  }
}
