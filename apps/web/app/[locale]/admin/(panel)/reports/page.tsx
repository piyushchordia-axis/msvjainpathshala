/**
 * Admin → Reports (`/admin/reports`).
 *
 * Lists released progress reports (`GET /v1/reports/me`). On-demand exports
 * are triggered via `POST /v1/admin/exports/*` (report.generation /
 * export.* BullMQ queues).
 */

import { listMyReports, type ReportRow } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export default async function AdminReportsPage() {
  let items: ReportRow[] = [];
  let error: string | null = null;
  try {
    const res = await listMyReports();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load reports.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Reports</h2>
        <p className="text-sm text-muted-foreground">
          Released progress reports for your students. Monthly reports are generated automatically;
          on-demand exports run through the report.generation queue.
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
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Generated</th>
                <th className="px-4 py-3">Released</th>
                <th className="px-4 py-3">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No released reports yet.
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{r.period_label}</td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                      {r.period_kind}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatWhen(r.generated_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatWhen(r.released_at)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.pdf_asset_id ? (
                        <span className="rounded-pill bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700">
                          Ready
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4 text-sm text-muted-foreground">
        <p className="font-medium text-secondary">Generate a report</p>
        <p className="mt-1">
          Student PDF and centre bulk ZIP exports are requested via{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">POST /v1/admin/exports/*</code> and
          processed on the report.generation and export queues. Poll{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">GET /v1/admin/exports/:id</code>{' '}
          for completion.
        </p>
      </Card>
    </div>
  );
}
