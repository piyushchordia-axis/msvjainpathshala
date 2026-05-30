/**
 * Admin → Batches (`/admin/batches`).
 *
 * Batches across the actor's centres. We list in-scope centres
 * (`GET /v1/centres`) then their batches (`GET /v1/centres/:id/batches`).
 * Authoring still lives in the mobile sanchalak flow.
 */

import { listAdminBatches, type AdminBatchRow } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDays(days: number[]): string {
  if (!days.length) return '—';
  return days.map((d) => DAY_NAMES[d] ?? d).join(', ');
}

function formatTime(start: string, end: string): string {
  const trim = (t: string) => (t ? t.slice(0, 5) : '');
  const s = trim(start);
  const e = trim(end);
  if (!s && !e) return '—';
  return `${s}–${e}`;
}

export default async function AdminBatchesPage() {
  let items: AdminBatchRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminBatches();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load batches.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Batches</h2>
        <p className="text-sm text-muted-foreground">
          Batches across your centres, with their schedule and assigned Guruji. Authoring lives in
          the mobile sanchalak flow.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Centre</th>
                <th className="px-4 py-3">Age group</th>
                <th className="px-4 py-3">Shikshak</th>
                <th className="px-4 py-3">Day / time</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No batches in scope yet.
                  </td>
                </tr>
              ) : (
                items.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{b.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{b.centre_name}</td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                      {b.age_group}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {b.shikshak_id ? 'Assigned' : 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-muted-foreground">{formatDays(b.day_of_week)}</span>
                      <span className="ml-2">{formatTime(b.start_time, b.end_time)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          b.status === 'active'
                            ? 'rounded-pill bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                            : 'rounded-pill bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'
                        }
                      >
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
