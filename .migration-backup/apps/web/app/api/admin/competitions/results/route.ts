/**
 * POST /api/admin/competitions/results
 *
 * Proxies to `POST /v1/admin/competitions/:id/results` to record ranks
 * BEFORE the publish step.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { recordResults } from '@/api/competitions';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  id: z.string().uuid(),
  results: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        rank: z.number().int().min(1).max(1000).nullable(),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1),
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
    const result = await recordResults(parsed.id, parsed.results);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Record results failed' } },
      { status: 500 },
    );
  }
}
