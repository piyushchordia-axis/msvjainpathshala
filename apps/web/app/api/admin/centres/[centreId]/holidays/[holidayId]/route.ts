import { proxyToApi } from '@/api/proxy';

// DELETE /api/admin/centres/:centreId/holidays/:holidayId — remove a holiday.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ centreId: string; holidayId: string }> },
) {
  const { centreId, holidayId } = await params;
  return proxyToApi(`/v1/centres/${centreId}/holidays/${holidayId}`, { method: 'DELETE' });
}
