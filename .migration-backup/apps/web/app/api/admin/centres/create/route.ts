/**
 * POST /api/admin/centres/create
 *
 * Proxy for the new-centre form. Forwards to POST /v1/centres (city_admin+)
 * carrying the admin's session token.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  city_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  address_line: z.string().max(500).optional(),
  locality: z.string().max(200).optional(),
  pincode: z
    .string()
    .regex(/^\d{4,10}$/)
    .optional(),
  gps_radius_m: z.number().int().min(10).max(5000).optional(),
  contact_phone: z.string().max(15).optional(),
  contact_email: z.string().email().optional(),
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

  try {
    const client = await authenticatedServerClient();
    const res = await client.post('/v1/centres', parsed);
    return NextResponse.json({ data: res.data.data }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not create centre' } },
      { status: 500 },
    );
  }
}
