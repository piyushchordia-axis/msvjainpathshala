/**
 * POST /api/admin/students/[id]/report
 *
 * Generate a progress-report PDF for a student. Proxies to
 * POST /v1/admin/reports/generate/:studentId (sanchalak+) and returns
 * { report, url } where url is a signed download URL for the rendered PDF.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  period_kind: z.enum(['monthly', 'termly']),
  period_label: z.string().min(1).max(40),
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
    const res = await client.post(`/v1/admin/reports/generate/${id}`, parsed);
    return NextResponse.json({ data: res.data?.data ?? res.data }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not generate progress report' } },
      { status: 500 },
    );
  }
}
