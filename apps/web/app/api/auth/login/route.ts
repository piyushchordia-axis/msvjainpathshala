/**
 * POST /api/auth/login
 *
 * Two-step OTP flow proxied to the backend:
 *
 *   { phase: 'send', phone }                     → 202 + otp_token
 *   { phase: 'verify', phone, code, device_id }  → 200 + sets cookies
 *
 * Combining both phases under one handler keeps the client component
 * small (a single `fetch('/api/auth/login', …)`). On verify success we
 * set the `jp_access` / `jp_refresh` / `jp_user` cookies and return the
 * user shape so the client can redirect by role.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { otpSend, otpVerify } from '@/api/auth-endpoints';
import { ApiError } from '@/api/server-client';
import { setSessionCookies } from '@/lib/auth-cookies';

const sendBody = z.object({
  phase: z.literal('send'),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 (+91…)'),
});
const verifyBody = z.object({
  phase: z.literal('verify'),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
  device_id: z.string().min(1).max(128),
});
const requestBody = z.discriminatedUnion('phase', [sendBody, verifyBody]);

function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.statusCode || 400 },
    );
  }
  return NextResponse.json(
    { error: { code: 'ERR_INTERNAL', message: 'Login failed' } },
    { status: 500 },
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  let parsed;
  try {
    parsed = requestBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'ERR_VALIDATION_FAILED',
          message:
            err instanceof z.ZodError ? (err.errors[0]?.message ?? 'Invalid body') : 'Invalid body',
        },
      },
      { status: 422 },
    );
  }

  try {
    if (parsed.phase === 'send') {
      const result = await otpSend(parsed.phone);
      return NextResponse.json({ data: result });
    }
    // verify
    const verified = await otpVerify({
      phone: parsed.phone,
      code: parsed.code,
      device_id: parsed.device_id,
      platform: 'web',
    });
    await setSessionCookies({
      access_token: verified.tokens.access_token,
      refresh_token: verified.tokens.refresh_token,
      access_expires_at: verified.tokens.access_expires_at,
      refresh_expires_at: verified.tokens.refresh_expires_at,
      user: verified.user,
    });
    return NextResponse.json({ data: { user: verified.user } });
  } catch (err) {
    return errorResponse(err);
  }
}
