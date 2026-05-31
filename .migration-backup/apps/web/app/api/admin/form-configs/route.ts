/**
 * GET  /api/admin/form-configs?persona=parent[&city_id=...] — resolve the
 *      active form config for a persona (falls back to global default).
 * POST /api/admin/form-configs — publish a new version (city_admin+).
 *
 * Both proxy to /v1/form-configs carrying the admin's session token.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const PERSONAS = ['student', 'parent', 'shikshak', 'sanchalak', 'city_admin'] as const;

const customFieldSchema = z.object({
  key: z.string().min(1).max(60),
  label_en: z.string().min(1).max(160),
  label_hi: z.string().min(1).max(160),
  type: z.enum([
    'text',
    'multiline',
    'number',
    'date',
    'select',
    'multiselect',
    'boolean',
    'phone',
    'email',
    'file',
  ]),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

const createSchema = z.object({
  city_id: z.string().uuid().nullable().optional(),
  form_kind: z.enum(PERSONAS),
  custom_fields: z.array(customFieldSchema),
});

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
    { status: 401 },
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!(await readAccessToken())) return unauthorized();
  const url = new URL(req.url);
  const persona = url.searchParams.get('persona') ?? '';
  const cityId = url.searchParams.get('city_id');
  if (!PERSONAS.includes(persona as (typeof PERSONAS)[number])) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION_FAILED', message: `Unknown persona '${persona}'` } },
      { status: 422 },
    );
  }
  try {
    const client = await authenticatedServerClient();
    const res = await client.get(
      `/v1/form-configs/${persona}${cityId ? `?city_id=${encodeURIComponent(cityId)}` : ''}`,
    );
    return NextResponse.json({ data: res.data.data });
  } catch (err) {
    if (err instanceof ApiError) {
      // 404 = no config yet; surface as an empty result the UI can handle.
      if (err.statusCode === 404) return NextResponse.json({ data: null });
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not load form config' } },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!(await readAccessToken())) return unauthorized();
  let parsed: z.infer<typeof createSchema>;
  try {
    parsed = createSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION_FAILED', message: (err as Error).message } },
      { status: 422 },
    );
  }
  try {
    const client = await authenticatedServerClient();
    const res = await client.post('/v1/form-configs', {
      form_kind: parsed.form_kind,
      city_id: parsed.city_id ?? null,
      custom_fields: parsed.custom_fields,
    });
    return NextResponse.json({ data: res.data.data }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not publish form config' } },
      { status: 500 },
    );
  }
}
