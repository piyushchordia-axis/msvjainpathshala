/**
 * POST /api/admin/platform-settings/80g
 *
 * Proxy for the 80G settings form. Forwards to the backend
 * `PATCH /v1/admin/platform-settings/80g` carrying the admin's session
 * token. Q3 is enforced both here and at the service layer: enabling 80G
 * requires registration number, trust name and trust address.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z
  .object({
    enabled: z.boolean(),
    eighty_g_registration_number: z.string().max(50).nullable().optional(),
    eighty_g_trust_name: z.string().max(200).nullable().optional(),
    eighty_g_trust_address: z.string().max(500).nullable().optional(),
    eighty_g_section: z.string().max(10).optional(),
  })
  .refine(
    (v) =>
      !v.enabled ||
      (!!v.eighty_g_registration_number && !!v.eighty_g_trust_name && !!v.eighty_g_trust_address),
    {
      message: 'Registration number, trust name and trust address are all required to enable 80G.',
    },
  );

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
    const res = await client.patch('/v1/admin/platform-settings/80g', parsed);
    return NextResponse.json({ data: res.data.data }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not update 80G settings' } },
      { status: 500 },
    );
  }
}
