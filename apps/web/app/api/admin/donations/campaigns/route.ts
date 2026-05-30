/**
 * POST /api/admin/donations/campaigns — proxy for
 * POST /v1/admin/donation-campaigns (city_admin+).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  name: z.string().min(2).max(180),
  description: z.string().max(2000).nullable().optional(),
  city_id: z.string().uuid().nullable().optional(),
  target_amount_paise: z.number().int().min(0).nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_public: z.boolean().optional(),
  progress_bar_visible: z.boolean().optional(),
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
    const res = await client.post('/v1/admin/donation-campaigns', parsed);
    return NextResponse.json({ data: res.data.data }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not create campaign' } },
      { status: 500 },
    );
  }
}
