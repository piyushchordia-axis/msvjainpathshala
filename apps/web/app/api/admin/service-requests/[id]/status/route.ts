/**
 * POST /api/admin/service-requests/[id]/status — proxy for
 * POST /v1/admin/service-requests/:id/status (sanchalak+).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { SERVICE_REQUEST_STATUSES } from '@jp/shared';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({ status: z.enum(SERVICE_REQUEST_STATUSES) });

export async function POST(
  req: Request,
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
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION_FAILED', message: (err as Error).message } },
      { status: 422 },
    );
  }
  try {
    const client = await authenticatedServerClient();
    const res = await client.post(`/v1/admin/service-requests/${id}/status`, {
      status: parsed.status,
    });
    return NextResponse.json({ data: res.data?.data ?? { ok: true } }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not update status' } },
      { status: 500 },
    );
  }
}
