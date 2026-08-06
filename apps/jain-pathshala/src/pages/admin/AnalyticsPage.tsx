import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminError, AdminPageShell } from '@/components/admin/AdminPageShell';
import { apiGet } from '@/lib/api-client';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

interface OverviewPayload {
  active_students: number;
  centres: number;
  open_service_requests: number;
  attendance_rate_30d: number;
  punya_awarded_30d: number;
  msv_active: number;
  /** Absent for roles outside DONATION_VIEW_ROLES (sanchalak, shikshak). */
  donations_total_paise_ytd?: number;
}

interface TrendPoint {
  month: string;
  attendance_rate: number | null;
  homework_completion_rate: number | null;
}

const EMPTY: OverviewPayload = {
  active_students: 0,
  centres: 0,
  open_service_requests: 0,
  attendance_rate_30d: 0,
  punya_awarded_30d: 0,
  msv_active: 0,
};

const chartConfig = {
  attendance_rate: { label: 'Attendance %', color: 'hsl(var(--secondary))' },
  homework_completion_rate: { label: 'Homework %', color: 'hsl(var(--primary))' },
} satisfies ChartConfig;

export default function AnalyticsPage() {
  const [data, setData] = useState<OverviewPayload>(EMPTY);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<OverviewPayload>('/v1/admin/analytics/overview'),
      apiGet<{ items: TrendPoint[] }>('/v1/admin/analytics/engagement-trend?months=6'),
    ])
      .then(([overview, engagement]) => {
        setData(overview ?? EMPTY);
        setTrend(engagement?.items ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load analytics.'))
      .finally(() => setLoading(false));
  }, []);

  const metrics = [
    { label: 'Active students', value: data.active_students },
    { label: 'Centres in scope', value: data.centres },
    { label: '30-day attendance', value: `${data.attendance_rate_30d.toFixed(1)}%` },
    { label: 'Punya awarded (30d)', value: data.punya_awarded_30d },
    { label: 'MSV approved', value: data.msv_active },
    { label: 'Open service requests', value: data.open_service_requests },
    // Only present for city_admin and above — the API omits it for scoped roles.
    ...(data.donations_total_paise_ytd === undefined
      ? []
      : [{
          label: 'Donations YTD',
          value: `₹${(data.donations_total_paise_ytd / 100).toLocaleString('en-IN')}`,
        }]),
  ];

  const chartData = useMemo(
    () =>
      trend.map((t) => ({
        month: t.month.slice(0, 7),
        attendance_rate: t.attendance_rate,
        homework_completion_rate: t.homework_completion_rate,
      })),
    [trend],
  );

  return (
    <AdminPageShell
      title="Analytics"
      subtitle="Attendance and homework completion trends for your scope."
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
              <div className="font-mono text-3xl text-secondary">
                {loading ? '…' : typeof m.value === 'number' ? m.value.toLocaleString('en-IN') : m.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Homework completion trend</CardTitle>
          <p className="text-sm text-muted-foreground">
            Monthly rates from the centre engagement view. Blank months mean no homework was set.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground">Loading chart…</div>
          ) : chartData.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No engagement months yet — the nightly analytics refresh fills this after attendance and homework land.
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="aspect-[16/7] w-full">
              <LineChart data={chartData} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="attendance_rate"
                  stroke="var(--color-attendance_rate)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="homework_completion_rate"
                  stroke="var(--color-homework_completion_rate)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </AdminPageShell>
  );
}
