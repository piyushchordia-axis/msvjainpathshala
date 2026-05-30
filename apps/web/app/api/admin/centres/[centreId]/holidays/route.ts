import { proxyToApi } from '@/api/proxy';

// GET /api/admin/centres/:centreId/holidays — list holidays (sanchalak+ scope).
export async function GET(_req: Request, { params }: { params: Promise<{ centreId: string }> }) {
  const { centreId } = await params;
  return proxyToApi(`/v1/centres/${centreId}/holidays`, { method: 'GET' });
}

// POST /api/admin/centres/:centreId/holidays — add a holiday { name, start_date, end_date }.
export async function POST(req: Request, { params }: { params: Promise<{ centreId: string }> }) {
  const { centreId } = await params;
  return proxyToApi(`/v1/centres/${centreId}/holidays`, {
    method: 'POST',
    body: await req.text(),
  });
}
