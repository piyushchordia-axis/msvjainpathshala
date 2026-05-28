/**
 * Admin — per-session roster.
 *
 * Matches the chip palette from `attendance-badges.html` exactly. Server
 * component; no client refresh.
 */

import { getSessionRoster } from '@/api/attendance';
import { Card } from '@/components/ui/card';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

const STATUS_PALETTE = {
  present: { bg: '#DCEEDD', fg: '#166534', label: 'Present' },
  absent: { bg: '#FBE5E5', fg: '#B91C1C', label: 'Absent' },
  late: { bg: '#FBEED0', fg: '#B45309', label: 'Late' },
  excused: { bg: '#DDE3F4', fg: '#1E3A8A', label: 'Excused' },
} as const;
const UNMARKED = { bg: '#F5EDE0', fg: '#8B6F5E', label: 'Not marked' };

export default async function AdminAttendanceSessionPage({ params }: PageProps) {
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getSessionRoster>> | null = null;
  let error: string | null = null;
  try {
    data = await getSessionRoster(id);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load session.';
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <h2 className="font-display text-2xl text-secondary">Session</h2>
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? 'Session not found'}
        </Card>
      </div>
    );
  }

  const session = data.session;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Session roster</h2>
          <p className="text-sm text-muted-foreground">
            {session.scheduled_date} · status {session.status}
          </p>
        </div>
      </header>

      <Card className="grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-4">
        <Metric
          label="Check-in"
          value={session.check_in_at ? new Date(session.check_in_at).toLocaleTimeString() : '—'}
        />
        <Metric
          label="Check-out"
          value={session.check_out_at ? new Date(session.check_out_at).toLocaleTimeString() : '—'}
        />
        <Metric
          label="Duration"
          value={session.duration_minutes ? `${session.duration_minutes} min` : '—'}
        />
        <Metric
          label="GPS distance"
          value={session.gps_haversine_m !== null ? `${session.gps_haversine_m} m` : '—'}
        />
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.students.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    No students assigned to this session&apos;s batch.
                  </td>
                </tr>
              ) : (
                data.students.map((s) => {
                  const palette = s.attendance
                    ? STATUS_PALETTE[s.attendance.status]
                    : s.pre_excused
                      ? STATUS_PALETTE.excused
                      : UNMARKED;
                  return (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground">{s.full_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {s.student_code}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          style={{ backgroundColor: palette.bg, color: palette.fg }}
                          className="rounded-pill px-2 py-0.5 text-xs font-semibold"
                        >
                          {palette.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {s.attendance?.notes ?? s.absence_reason ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold text-foreground">{value}</div>
    </div>
  );
}
