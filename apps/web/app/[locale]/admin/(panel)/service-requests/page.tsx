/**
 * Admin → Service requests (`/admin/service-requests`, sanchalak+).
 *
 * Lists requests in the actor's scope and lets staff change a request's status
 * inline. Rows are typed defensively — only the fields we render are required.
 */

import { authenticatedServerClient } from '@/api/server-client';
import { Card } from '@/components/ui/card';

import { ServiceRequestStatus } from './service-request-status';

interface SrRow {
  id: string;
  category?: string;
  description?: string;
  status?: string;
  created_at?: string;
}

function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

async function load(): Promise<{ rows: SrRow[]; error: string | null }> {
  try {
    const client = await authenticatedServerClient();
    const res = await client.get<{ data: { items: SrRow[] } }>('/v1/admin/service-requests');
    return { rows: res.data.data.items ?? [], error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : 'Could not load requests.' };
  }
}

export default async function ServiceRequestsPage() {
  const { rows, error } = await load();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Service requests</h2>
        <p className="text-sm text-muted-foreground">
          Parent requests in your scope. Change the status as you work each one.
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
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Request</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No service requests in scope.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium capitalize">{r.category ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <span className="line-clamp-2">{r.description ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {timeAgo(r.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <ServiceRequestStatus id={r.id} status={r.status ?? 'open'} />
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
