/**
 * Admin attendance log — `/admin/attendance`.
 *
 * Matches `jp-design-system/preview/admin-table.html` layout: title row,
 * a centre-id filter via querystring, then a row-density table of today's
 * sessions across the scope. Distance column flags off-site check-ins in
 * the amber palette.
 *
 * The centre dropdown is intentionally simple in this step — admins paste
 * the centre id into the URL or via the dashboard's centre list. A
 * proper picker lands when the centres-admin module ships.
 */

import { listCentreAttendanceLog, type AdminCentreLogItem } from '@/api/attendance';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface PageProps {
  searchParams: Promise<{ centre_id?: string; from?: string }>;
}

export default async function AdminAttendancePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const centreId = sp.centre_id;
  const date = sp.from ?? todayIso();

  let items: AdminCentreLogItem[] = [];
  let error: string | null = null;
  if (centreId) {
    try {
      const res = await listCentreAttendanceLog(centreId, { from: date });
      items = res.items;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load the attendance log.';
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Attendance</h2>
          <p className="text-sm text-muted-foreground">
            Today&apos;s sessions across your scope. Off-site check-ins are flagged.
          </p>
        </div>
      </header>

      {!centreId ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Pass a centre id in the URL to view its sessions, e.g.
          <code className="ml-2 rounded bg-muted px-2 py-1 font-mono text-xs">
            /admin/attendance?centre_id=&lt;uuid&gt;
          </code>
          . A centre picker lands in a follow-up step.
        </Card>
      ) : null}

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      {centreId ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-4 py-3">Distance</th>
                  <th className="px-4 py-3 text-right">Present</th>
                  <th className="px-4 py-3 text-right">Absent</th>
                  <th className="px-4 py-3 text-right">Late</th>
                  <th className="px-4 py-3 text-right">Excused</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      No sessions for {date}.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => {
                    const offSite =
                      row.session.gps_haversine_m !== null &&
                      row.session.gps_haversine_m > row.gps_radius_m;
                    return (
                      <tr key={row.session.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-foreground">{row.batch_name}</td>
                        <td className="px-4 py-3">
                          <SessionStatusBadge status={row.session.status} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {row.session.check_in_at
                            ? new Date(row.session.check_in_at).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {row.session.gps_haversine_m !== null ? (
                            offSite ? (
                              <span className="rounded-pill bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                Off-site {row.session.gps_haversine_m}m
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {row.session.gps_haversine_m}m
                              </span>
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                          {row.counts.present}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-red-700">
                          {row.counts.absent}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-700">{row.counts.late}</td>
                        <td className="px-4 py-3 text-right text-blue-800">{row.counts.excused}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={
                              `/admin/attendance/sessions/${row.session.id}` as `/admin/attendance/sessions/${string}`
                            }
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {items.length > 0 ? (
            <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              <span>
                Showing <Badge variant="neutral">{items.length}</Badge> session
                {items.length !== 1 ? 's' : ''} on {date}.
              </span>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function SessionStatusBadge({
  status,
}: {
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
}) {
  const palette: Record<string, string> = {
    scheduled: 'bg-amber-50 text-amber-700',
    in_progress: 'bg-emerald-50 text-emerald-700',
    completed: 'bg-muted text-foreground',
    cancelled: 'bg-red-50 text-red-700',
  };
  const labels: Record<string, string> = {
    scheduled: 'Scheduled',
    in_progress: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return (
    <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${palette[status] ?? ''}`}>
      {labels[status] ?? status}
    </span>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
