/**
 * DELETE /api/admin/centres/:centreId/holidays/:holidayId — remove a holiday.
 * Proxies to /v1/centres/:centreId/holidays/:holidayId (sanchalak+).
 */

import { NextResponse } from 'next/server';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ centreId: string; holidayId: string }> },
): Promise<NextResponse> {
  if (!(await readAccessToken())) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  const { centreId, holidayId } = await params;
  try {
    const client = await authenticatedServerClient();
    await client.delete(`/v1/centres/${centreId}/holidays/${holidayId}`);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not remove holiday' } },
      { status: 500 },
    );
  }
}
