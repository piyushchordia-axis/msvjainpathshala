/**
 * Admin dashboard home. Layout mirrors
 * `jp-design-system/ui_kits/admin/screens.jsx` DashboardScreen:
 *
 *   - Greeting block (date + "Good morning, {Name}")
 *   - 4-column stats grid (real, scope-aware)
 *   - 2-col lower section: scope summary + awaiting-approval queue
 *   - Live activity feed (Socket.IO)
 *
 * All numbers come from `/v1/admin/analytics/overview` and the pending
 * enrolments list, fetched server-side through the panel's JWT cookie.
 * The page degrades gracefully (zeros / empty queue) if a call fails or
 * the actor's role can't see a given endpoint.
 */

import { CheckCircle2, Flame, GraduationCap, Sparkles } from 'lucide-react';

import { listEnrolments, type AdminEnrolment } from '@/api/enrolments';
import { authenticatedServerClient } from '@/api/server-client';
import { LiveActivityCard } from '@/components/admin/LiveActivityCard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { readSessionUser } from '@/lib/auth-cookies';

interface OverviewPayload {
  active_students: number;
  centres: number;
  open_service_requests: number;
  attendance_rate_30d: number;
  punya_awarded_30d: number;
  msv_active: number;
  donations_total_paise_ytd: number;
}

const EMPTY_OVERVIEW: OverviewPayload = {
  active_students: 0,
  centres: 0,
  open_service_requests: 0,
  attendance_rate_30d: 0,
  punya_awarded_30d: 0,
  msv_active: 0,
  donations_total_paise_ytd: 0,
};

async function safeOverview(): Promise<OverviewPayload | null> {
  try {
    const client = await authenticatedServerClient();
    const res = await client.get<{ data: OverviewPayload }>('/v1/admin/analytics/overview');
    return res.data.data;
  } catch {
    return null;
  }
}

async function safePendingEnrolments(): Promise<AdminEnrolment[]> {
  try {
    const { items } = await listEnrolments({ status: 'pending', limit: 8 });
    return items;
  } catch {
    return [];
  }
}

function todayString(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default async function AdminDashboard() {
  const user = await readSessionUser();
  const firstName = (user?.full_name ?? '').split(/\s+/)[0] || 'there';

  const [overview, pending] = await Promise.all([safeOverview(), safePendingEnrolments()]);
  const o = overview ?? EMPTY_OVERVIEW;

  const stats = [
    {
      label: 'Active students',
      value: o.active_students.toLocaleString('en-IN'),
      delta: `${o.centres} centres in scope`,
      icon: GraduationCap,
    },
    {
      label: '30-day attendance',
      value: `${o.attendance_rate_30d.toFixed(1)}%`,
      delta: 'rolling window',
      icon: CheckCircle2,
    },
    {
      label: 'Punya awarded',
      value: o.punya_awarded_30d.toLocaleString('en-IN'),
      delta: 'this month',
      icon: Sparkles,
    },
    {
      label: 'Pending enrolments',
      value: String(pending.length),
      delta: 'awaiting your approval',
      icon: Flame,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {todayString()}
          </div>
          <h2 className="mt-1 font-display text-3xl text-secondary">Good morning, {firstName}</h2>
          <p className="text-sm text-muted-foreground">
            Here&apos;s a snapshot of what&apos;s waiting for you.
          </p>
        </div>
      </div>

      <section aria-labelledby="stats-heading">
        <h3 id="stats-heading" className="sr-only">
          Key numbers
        </h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label}>
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </div>
                    <div className="mt-1 font-display text-2xl leading-none text-secondary">
                      {s.value}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{s.delta}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>In your scope</CardTitle>
            <CardDescription>Live totals across the centres you oversee.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <ScopeStat label="Centres" value={o.centres.toLocaleString('en-IN')} />
              <ScopeStat label="MSV approved" value={o.msv_active.toLocaleString('en-IN')} />
              <ScopeStat
                label="Open requests"
                value={o.open_service_requests.toLocaleString('en-IN')}
              />
              <ScopeStat
                label="Donations YTD"
                value={`₹${(o.donations_total_paise_ytd / 100).toLocaleString('en-IN')}`}
              />
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Full trends and tier breakdowns live under Analytics.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Awaiting your approval</CardTitle>
            <CardDescription>Pending enrolment requests in your scope.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing waiting right now — you&apos;re all caught up.
              </p>
            ) : (
              pending.map((p, i) => (
                <div key={p.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        Enrolment request
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        Review under Enrolments
                      </div>
                    </div>
                    <Badge variant="warning">{timeAgo(p.created_at)}</Badge>
                  </div>
                  {i < pending.length - 1 ? <Separator className="mt-3" /> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <LiveActivityCard />
      </section>
    </div>
  );
}

function ScopeStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-display text-2xl leading-none text-secondary">{value}</dd>
    </div>
  );
}
