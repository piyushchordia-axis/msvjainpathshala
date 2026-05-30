/**
 * POST /api/admin/quiz-events/:id/start — start a scheduled quiz event.
 * Proxies to /v1/quiz-events/:id/start (city_admin+).
 */

import { NextResponse } from 'next/server';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await readAccessToken())) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  const { id } = await params;
  try {
    const client = await authenticatedServerClient();
    const res = await client.post(`/v1/quiz-events/${id}/start`, {});
    return NextResponse.json({ data: res.data.data });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not start quiz' } },
      { status: 500 },
    );
  }
}
