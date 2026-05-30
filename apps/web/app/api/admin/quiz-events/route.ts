/**
 * POST /api/admin/quiz-events — create a scheduled quiz event.
 * Proxies to /v1/admin/quiz-events (city_admin+).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z
  .object({
    title: z.string().min(2).max(160),
    audience_kind: z.enum(['all', 'msv_only', 'age_group', 'batch', 'centre', 'city']),
    starts_at: z.string().datetime({ offset: true }),
    duration_minutes: z.number().int().min(1).max(600),
    question_ids: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  if (!(await readAccessToken())) {
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
    const res = await client.post('/v1/admin/quiz-events', parsed);
    return NextResponse.json({ data: res.data.data }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not create quiz' } },
      { status: 500 },
    );
  }
}
