/**
 * POST /api/admin/punya/reverse
 *
 * Proxy for the audit-page reversal button. Forwards to
 * `POST /v1/punya/reverse`.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { reverseTransaction } from '@/api/punya';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  source_id: z.string().uuid(),
  reason: z.string().min(3).max(500),
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
    const result = await reverseTransaction(parsed);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Reversal failed' } },
      { status: 500 },
    );
  }
}
