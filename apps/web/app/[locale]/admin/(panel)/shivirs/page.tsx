/**
 * Admin shivirs list — `/admin/shivirs` (Step 15).
 *
 * Matches the row-density admin table look from
 * `jp-design-system/preview/admin-table.html`. Listing is scoped server-side
 * (the `/v1/shivirs` endpoint filters by city for non-super_admin actors).
 */

import { listShivirs, type ShivirEventSummary } from '@/api/shivirs';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export default async function AdminShivirsPage() {
  let items: ShivirEventSummary[] = [];
  let error: string | null = null;
  try {
    const res = await listShivirs();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load shivirs.';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Shivirs</h2>
          <p className="text-sm text-muted-foreground">
            Multi-day camps with QR-based volunteer check-in.
          </p>
        </div>
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
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3 text-right">Sessions</th>
                <th className="px-4 py-3"></th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No shivirs yet — create one to get started.
                  </td>
                </tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <div>{s.name}</div>
                      {s.msv_only ? (
                        <div className="mt-1">
                          <Badge variant="warning">MSV-only</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{s.start_date}</td>
                    <td className="px-4 py-3">{s.end_date}</td>
                    <td className="px-4 py-3">
                      <ModeBadge mode={s.attendance_mode} />
                    </td>
                    <td className="px-4 py-3 text-right">{s.sessions_count}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/shivirs/${s.id}` as `/admin/shivirs/${string}`}
                        className="text-saffron hover:underline"
                      >
                        Detail
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/shivirs/${s.id}/live` as `/admin/shivirs/${string}/live`}
                        className="text-saffron hover:underline"
                      >
                        Live ↗
                      </Link>
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

function ModeBadge({ mode }: { mode: 'in_out' | 'present_only' }) {
  if (mode === 'in_out') return <Badge variant="info">In/Out</Badge>;
  return <Badge variant="neutral">Present-only</Badge>;
}
