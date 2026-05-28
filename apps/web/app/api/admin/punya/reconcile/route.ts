/**
 * POST /api/admin/punya/reconcile — super_admin manual trigger.
 */

import { NextResponse } from 'next/server';

import { runReconcile } from '@/api/punya';
import { ApiError } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

export async function POST(): Promise<NextResponse> {
  const token = await readAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  try {
    const result = await runReconcile();
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Reconcile failed' } },
      { status: 500 },
    );
  }
}
