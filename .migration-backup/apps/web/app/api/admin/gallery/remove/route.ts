/**
 * POST /api/admin/gallery/remove  { id, reason }  → removeGalleryItem
 *
 * Notifies the parent and writes an audit row on the API side.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { removeGalleryItem } from '@/api/niyams';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const body = z.object({
  id: z.string().uuid(),
  reason: z.string().min(20).max(500),
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
    const data = await removeGalleryItem(parsed.id, parsed.reason);
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Remove failed' } },
      { status: 500 },
    );
  }
}
