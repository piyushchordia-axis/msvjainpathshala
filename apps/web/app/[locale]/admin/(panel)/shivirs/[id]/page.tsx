/**
 * Admin shivir detail — `/admin/shivirs/[id]` (Step 15).
 *
 * Shows the event metadata, the configured sessions, and the volunteer
 * roster. The "live" subview links to `/admin/shivirs/[id]/live`.
 */

import { getShivir, type ShivirDetail } from '@/api/shivirs';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminShivirDetailPage({ params }: PageProps) {
  const { id } = await params;
  let detail: ShivirDetail | null = null;
  let error: string | null = null;
  try {
    detail = await getShivir(id);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load shivir.';
  }

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </Card>
    );
  }
  if (!detail) return null;

  const { event, sessions, volunteers, registration_count } = detail;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">{event.name}</h2>
          <p className="text-sm text-muted-foreground">
            {event.start_date} → {event.end_date} ·{' '}
            <Badge variant={event.attendance_mode === 'in_out' ? 'info' : 'neutral'}>
              {event.attendance_mode === 'in_out' ? 'In/Out' : 'Present-only'}
            </Badge>
            {event.msv_only ? (
              <>
                {' · '}
                <Badge variant="warning">MSV-only</Badge>
              </>
            ) : null}
          </p>
        </div>
        <Link
          href={`/admin/shivirs/${id}/live` as `/admin/shivirs/${string}/live`}
          className="rounded-md bg-saffron px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Open live dashboard ↗
        </Link>
      </header>

      {event.description ? (
        <Card className="p-4 text-sm text-foreground/90">{event.description}</Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Registered students" value={registration_count.toLocaleString()} />
        <StatCard label="Sessions" value={sessions.length.toString()} />
        <StatCard label="Volunteers" value={volunteers.length.toString()} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-muted/40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sessions
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/20 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Day</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sessions.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-medium">{s.day_number}</td>
                <td className="px-4 py-3">{s.session_date}</td>
                <td className="px-4 py-3">{s.start_time}</td>
                <td className="px-4 py-3">{s.end_time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-sub">
        {label}
      </div>
      <div className="font-display text-3xl text-foreground">{value}</div>
    </Card>
  );
}
