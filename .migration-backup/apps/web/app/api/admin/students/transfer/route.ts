/**
 * POST /api/admin/students/transfer
 *
 * Move a student to a different batch. Proxies to
 * POST /v1/enrolments/students/:studentId/transfer (city_admin+).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  student_id: z.string().uuid(),
  target_batch_id: z.string().uuid(),
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
    const res = await client.post(`/v1/enrolments/students/${parsed.student_id}/transfer`, {
      target_batch_id: parsed.target_batch_id,
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
      { error: { code: 'ERR_INTERNAL', message: 'Could not transfer student' } },
      { status: 500 },
    );
  }
}
