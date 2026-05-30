/**
 * POST /api/admin/students/[id]/status
 *
 * Deactivate / reactivate a student (Q11 — never hard-delete). Proxies to
 * POST /v1/students/:id/{deactivate,reactivate} (sanchalak+).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z
  .object({
    action: z.enum(['deactivate', 'reactivate']),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.action !== 'deactivate' || !!v.reason?.trim(), {
    message: 'A reason is required to deactivate a student.',
  });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
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
    const payload = parsed.action === 'deactivate' ? { reason: parsed.reason } : {};
    const res = await client.post(`/v1/students/${id}/${parsed.action}`, payload);
    return NextResponse.json({ data: res.data?.data ?? { ok: true } }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not update student status' } },
      { status: 500 },
    );
  }
}
