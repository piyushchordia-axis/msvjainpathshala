/**
 * POST /api/admin/exams/otp — proxies to /v1/admin/exams/:id/otp.
 *
 * Returns `{ data: { exam_id, exam_otp, otp_valid_until } }`. The UI renders
 * the OTP verbatim so the admin can read it aloud at the start of the exam.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { generateExamOtp } from '@/api/exams';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({ id: z.string().uuid() });

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
    const out = await generateExamOtp(parsed.id);
    return NextResponse.json({ data: out }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'OTP generation failed' } },
      { status: 500 },
    );
  }
}
