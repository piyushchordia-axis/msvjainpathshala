/**
 * POST /api/admin/punya/manual-award
 *
 * Proxy for the manual-award form. Forwards to
 * `POST /v1/admin/punya/manual-award` carrying the admin's session token.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { manualAward } from '@/api/punya';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  student_id: z.string().uuid(),
  feature_key: z.string().min(1).max(64),
  points: z.number().int(),
  reason: z.string().min(3).max(500),
  is_msv_track: z.boolean().optional(),
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
    const result = await manualAward(parsed);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Award failed' } },
      { status: 500 },
    );
  }
}
