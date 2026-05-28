/**
 * Admin enrolments table — `/admin/enrolments`.
 *
 * Matches `jp-design-system/preview/admin-table.html` layout: title +
 * filter chips above a row-density data grid with sortable headers and
 * a status pill column (StatusBadge variants from Step 9).
 *
 * Step 10 ships a server-component snapshot (no client refresh, no bulk
 * actions yet — bulk approve lands in a follow-up). Filters use plain
 * query-string round-trips so the URL is shareable / bookmarkable.
 */

import { listEnrolments, type EnrolmentStatus } from '@/api/enrolments';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface PageProps {
  searchParams: Promise<{ status?: string; search?: string }>;
}

const STATUS_FILTERS: Array<{ value: EnrolmentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function isStatus(v: string | undefined): v is EnrolmentStatus {
  return v === 'pending' || v === 'approved' || v === 'rejected' || v === 'waitlisted';
}

export default async function AdminEnrolmentsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const status = isStatus(sp.status) ? sp.status : undefined;

  let items = [] as Awaited<ReturnType<typeof listEnrolments>>['items'];
  let error: string | null = null;
  try {
    const res = await listEnrolments({ ...(status ? { status } : {}) });
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load enrolments.';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Enrolments</h2>
          <p className="text-sm text-muted-foreground">
            Approve, waitlist, or reject pending applications.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => {
            const active = (status ?? 'all') === f.value;
            return (
              <Link
                key={f.value}
                href={
                  f.value === 'all'
                    ? '/admin/enrolments'
                    : (`/admin/enrolments?status=${f.value}` as `/admin/enrolments`)
                }
                className={[
                  'rounded-pill border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted',
                ].join(' ')}
              >
                {f.label}
              </Link>
            );
          })}
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
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Centre</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Decided</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No enrolments match the current filter.
                  </td>
                </tr>
              ) : (
                items.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-foreground">
                      {new Date(e.created_at).toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {e.requested_centre_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {e.requested_batch_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {e.decided_at
                        ? new Date(e.decided_at).toLocaleString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/enrolments/${e.id}` as `/admin/enrolments/${string}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {items.length > 0 ? (
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <span>
              Showing <Badge variant="neutral">{items.length}</Badge> result
              {items.length !== 1 ? 's' : ''}.
            </span>
            <span>Bulk actions land in a follow-up step.</span>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
