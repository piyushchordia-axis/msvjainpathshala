import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminError, AdminPageShell } from '@/components/admin/AdminPageShell';
import { apiGet } from '@/lib/api-client';

interface OverviewPayload {
  active_students: number;
  centres: number;
  open_service_requests: number;
  attendance_rate_30d: number;
  punya_awarded_30d: number;
  msv_active: number;
  donations_total_paise_ytd: number;
}

const EMPTY: OverviewPayload = {
  active_students: 0,
  centres: 0,
  open_service_requests: 0,
  attendance_rate_30d: 0,
  punya_awarded_30d: 0,
  msv_active: 0,
  donations_total_paise_ytd: 0,
};

export default function AnalyticsPage() {
  const [data, setData] = useState<OverviewPayload>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<OverviewPayload>('/v1/admin/analytics/overview')
      .then((r) => setData(r ?? EMPTY))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load analytics.'))
      .finally(() => setLoading(false));
  }, []);

  const metrics = [
    { label: 'Active students', value: data.active_students },
    { label: 'Centres in scope', value: data.centres },
    { label: '30-day attendance', value: `${data.attendance_rate_30d.toFixed(1)}%` },
    { label: 'Punya awarded (30d)', value: data.punya_awarded_30d },
    { label: 'MSV approved', value: data.msv_active },
    { label: 'Pending enrolments', value: data.open_service_requests },
    { label: 'Donations YTD', value: `₹${(data.donations_total_paise_ytd / 100).toLocaleString('en-IN')}` },
  ];

  return (
    <AdminPageShell
      title="Analytics"
      subtitle="Attendance trends and network totals for your scope."
    >
      {error ? <AdminError message={error} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {m.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-display text-3xl text-secondary">
                {loading ? '…' : typeof m.value === 'number' ? m.value.toLocaleString('en-IN') : m.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AdminPageShell>
  );
}
