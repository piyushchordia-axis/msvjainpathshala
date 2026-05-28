/**
 * POST /api/admin/notices/estimate-sms
 *
 * Returns the recipient + SMS-cost estimate for the in-progress notice form
 * so the "Critical" toggle's ConfirmDialog can render an exact cost line.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { estimateSmsCost } from '@/api/notices';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  scope: z.enum(['batch', 'centre', 'city', 'state', 'national', 'msv']),
  centre_id: z.string().uuid().optional(),
  batch_id: z.string().uuid().optional(),
  msv_only: z.boolean().optional(),
  content_en: z.string().min(2).max(4000),
  content_hi: z.string().min(2).max(4000),
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
    const result = await estimateSmsCost(parsed);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'SMS cost estimate failed' } },
      { status: 500 },
    );
  }
}
