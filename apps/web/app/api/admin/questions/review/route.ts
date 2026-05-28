/**
 * POST /api/admin/questions/review — proxies to /v1/admin/questions/:id/review.
 *
 * Body: { id: uuid, decision: 'approve' | 'reject' }.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { reviewAiQuestion } from '@/api/questions';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  id: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});

export async function POST(req: Request): Promise<NextResponse> {
  const token = await readAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  let parsed;
  try {
    parsed = body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION_FAILED', message: (err as Error).message } },
      { status: 422 },
    );
  }
  try {
    const out = await reviewAiQuestion(parsed.id, parsed.decision);
    return NextResponse.json({ data: out }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Review failed' } },
      { status: 500 },
    );
  }
}
