/**
 * POST /api/admin/curriculum/create — server route that proxies to
 * /v1/admin/curricula. The backend service enforces Q2 (MSV → super_admin
 * only). We forward the error envelope so the UI can render the verbatim
 * `ERR_RBAC_FORBIDDEN_MSV_CURRICULUM` code.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createCurriculum } from '@/api/curriculum';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  kind: z.enum(['standard', 'msv']),
  name: z.string().min(2).max(140),
  academic_year: z.string().max(40).optional(),
  template_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
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
    const row = await createCurriculum(parsed);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Curriculum create failed' } },
      { status: 500 },
    );
  }
}
