/**
 * Admin analytics dashboard — Step 22 (SPEC §6.25, §12).
 *
 * Layout mirrors `jp-design-system/preview/admin-stats.html`:
 *   - 3-up KPI grid (Active students / Attendance / Punya awarded)
 *   - Recharts line chart for attendance trends (saffron stroke)
 *   - Recharts bar chart for spiritual-tier distribution using the locked
 *     CLAUDE.md colours (Jigyasu earth, Shravak green, Sadhak blue,
 *     Shraman maroon, Tirthankar gold).
 *
 * Data is fetched server-side from /v1/admin/analytics/* via the panel's
 * existing JWT cookie. The page degrades gracefully when the API is
 * unreachable (empty values + a friendly stub).
 */

import { TrendingDown, TrendingUp } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { readSessionUser } from '@/lib/auth-cookies';

import AnalyticsCharts, { type ChartProps } from './analytics-charts';

const TIER_COLOURS: Record<string, string> = {
  jigyasu: '#8B6F5E',
  shravak: '#166534',
  sadhak: '#1E3A8A',
  shraman: '#7A1818',
  tirthankar: '#C8941F',
};

interface OverviewPayload {
  active_students: number;
  centres: number;
  open_service_requests: number;
  attendance_rate_30d: number;
  punya_awarded_30d: number;
  msv_active: number;
  donations_total_paise_ytd: number;
  tier_distribution?: Array<{ tier: string; student_count: number }>;
}

interface AttendanceRow {
  city_id: string;
  day: string;
  attendance_rate: number;
  present_count: number;
  total_marks: number;
}

async function safeFetch<T>(path: string): Promise<T | null> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: T };
    return json.data;
  } catch {
    return null;
  }
}

export default async function AnalyticsDashboard() {
  const user = await readSessionUser();
  const firstName = (user?.full_name ?? '').split(/\s+/)[0] || 'there';

  const [overview, attendanceWrap] = await Promise.all([
    safeFetch<OverviewPayload>('/v1/admin/analytics/overview'),
    safeFetch<{ items: AttendanceRow[] }>('/v1/admin/analytics/attendance?days=30'),
  ]);

  const o: OverviewPayload = overview ?? {
    active_students: 0,
    centres: 0,
    open_service_requests: 0,
    attendance_rate_30d: 0,
    punya_awarded_30d: 0,
    msv_active: 0,
    donations_total_paise_ytd: 0,
    tier_distribution: [],
  };
  const trend = (attendanceWrap?.items ?? []).map((r) => ({
    day: r.day,
    rate: r.attendance_rate,
  }));
  const tierBars = (o.tier_distribution ?? []).map((row) => ({
    tier: row.tier.charAt(0).toUpperCase() + row.tier.slice(1),
    count: row.student_count,
    fill: TIER_COLOURS[row.tier] ?? '#8B6F5E',
  }));

  const chartProps: ChartProps = { trend, tierBars };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Analytics
        </div>
        <h2 className="mt-1 font-display text-3xl text-secondary">Hello {firstName}</h2>
        <p className="text-sm text-muted-foreground">
          Last refresh: nightly 04:00 IST · Cache TTL 5 min · Scope: {user?.role}
        </p>
      </div>

      {/* KPI grid — mirrors admin-stats.html. */}
      <section className="grid gap-4 md:grid-cols-3">
        <KpiCard
          label="Active students"
          value={o.active_students.toLocaleString('en-IN')}
          delta={`${o.centres} centres in scope`}
          trend="up"
        />
        <KpiCard
          label="30-day attendance"
          value={`${o.attendance_rate_30d.toFixed(1)}%`}
          delta="rolling window"
          trend={o.attendance_rate_30d >= 85 ? 'up' : 'down'}
        />
        <KpiCard
          label="Punya awarded"
          value={o.punya_awarded_30d.toLocaleString('en-IN')}
          delta="this month"
          trend="up"
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>MSV pipeline</CardTitle>
            <CardDescription>
              {o.msv_active.toLocaleString('en-IN')} MSV-approved students
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-display text-3xl text-primary">{o.msv_active}</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Open service requests in scope: {o.open_service_requests}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Donations · YTD</CardTitle>
            <CardDescription>Captured donations across your scope</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-display text-3xl text-primary">
              ₹{(o.donations_total_paise_ytd / 100).toLocaleString('en-IN')}
            </div>
          </CardContent>
        </Card>
      </section>

      <AnalyticsCharts {...chartProps} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  trend,
}: {
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down';
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : TrendingDown;
  const trendClass =
    trend === 'up'
      ? 'bg-status-success-soft text-status-success ring-status-success/40'
      : 'bg-status-warning-soft text-status-warning ring-status-warning/40';
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 font-display text-4xl leading-tight text-secondary">{value}</div>
        <span
          className={`mt-2 inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${trendClass}`}
        >
          <TrendIcon className="size-3" />
          {delta}
        </span>
      </CardContent>
    </Card>
  );
}
