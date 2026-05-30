/**
 * POST /api/admin/niyams/create
 *
 * Proxy for the create-niyam form. Forwards to POST /v1/admin/niyams
 * (shikshak+). Scoped niyams for 'all' / 'msv_only' audiences need no filters.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  title_en: z.string().min(2).max(140),
  title_hi: z.string().min(2).max(140),
  description_en: z.string().max(1000).optional(),
  description_hi: z.string().max(1000).optional(),
  type: z.string().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  audience_kind: z.enum(['all', 'msv_only']),
  proof_type: z.string().min(1),
  points_value: z.number().int().min(1).max(200),
});

export async function POST(req: Request): Promise<NextResponse> {
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
    const res = await client.post('/v1/admin/niyams', parsed);
    return NextResponse.json({ data: res.data.data }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not create niyam' } },
      { status: 500 },
    );
  }
}
