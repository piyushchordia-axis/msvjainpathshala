/**
 * GET  /api/admin/centres/:centreId/holidays — list a centre's holidays.
 * POST /api/admin/centres/:centreId/holidays — add one { name, start_date, end_date }.
 *
 * Both proxy to /v1/centres/:centreId/holidays carrying the admin's session
 * token (list is sanchalak+ scoped; create is sanchalak+).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createBody = z.object({
  name: z.string().min(1).max(200),
  start_date: isoDate,
  end_date: isoDate,
});

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
    { status: 401 },
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ centreId: string }> },
): Promise<NextResponse> {
  if (!(await readAccessToken())) return unauthorized();
  const { centreId } = await params;
  try {
    const client = await authenticatedServerClient();
    const res = await client.get(`/v1/centres/${centreId}/holidays`);
    return NextResponse.json({ data: res.data.data });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not load holidays' } },
      { status: 500 },
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ centreId: string }> },
): Promise<NextResponse> {
  if (!(await readAccessToken())) return unauthorized();
  const { centreId } = await params;

  let parsed: z.infer<typeof createBody>;
  try {
    parsed = createBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION_FAILED', message: (err as Error).message } },
      { status: 422 },
    );
  }

  try {
    const client = await authenticatedServerClient();
    const res = await client.post(`/v1/centres/${centreId}/holidays`, parsed);
    return NextResponse.json({ data: res.data.data }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not add holiday' } },
      { status: 500 },
    );
  }
}
