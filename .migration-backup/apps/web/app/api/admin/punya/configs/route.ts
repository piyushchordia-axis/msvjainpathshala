/**
 * POST /api/admin/punya/configs
 *
 * Proxy that lifts the admin's `city_id` out of the session cookie and
 * forwards the upsert to `POST /v1/admin/punya/configs`. Keeps the
 * client-side form free of city resolution logic.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { upsertConfig } from '@/api/punya';
import { ApiError } from '@/api/server-client';
import { readAccessToken, readSessionUser } from '@/lib/auth-cookies';

const body = z.object({
  feature_id: z.string().uuid(),
  points_override: z.number().int(),
  min_points: z.number().int().optional(),
  max_points: z.number().int().optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const token = await readAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  // city_id comes from the session — super_admin must POST directly.
  const cityId = (user as { city_id?: string }).city_id;
  if (!cityId && user.role !== 'super_admin' && user.role !== 'state_admin') {
    return NextResponse.json(
      { error: { code: 'ERR_RBAC_OUT_OF_SCOPE', message: 'No city in session' } },
      { status: 403 },
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
    const result = await upsertConfig({
      city_id: cityId ?? '00000000-0000-0000-0000-000000000000',
      feature_id: parsed.feature_id,
      points_override: parsed.points_override,
      ...(parsed.min_points !== undefined ? { min_points: parsed.min_points } : {}),
      ...(parsed.max_points !== undefined ? { max_points: parsed.max_points } : {}),
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Save failed' } },
      { status: 500 },
    );
  }
}
