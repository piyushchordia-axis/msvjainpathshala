/**
 * POST /api/admin/batches/create
 *
 * Proxy for the new-batch form. Forwards to
 * `POST /v1/centres/:centreId/batches` (sanchalak+) carrying the admin's
 * session token. The backend schema takes the schedule object; centre_id is
 * the URL param here.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

const body = z.object({
  centre_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  age_group: z.enum(['bal', 'kishor', 'tarun', 'yuva']),
  capacity: z.number().int().min(1).max(500),
  schedule: z.object({
    days: z.array(z.number().int().min(1).max(7)).min(1),
    start_time: z.string().regex(hhmm),
    end_time: z.string().regex(hhmm),
  }),
  language_preference: z.string().min(1).max(40).optional(),
  academic_year: z.string().max(20).optional(),
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

  const { centre_id, ...batch } = parsed;
  try {
    const client = await authenticatedServerClient();
    const res = await client.post(`/v1/centres/${centre_id}/batches`, batch);
    return NextResponse.json({ data: res.data.data }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not create batch' } },
      { status: 500 },
    );
  }
}
