/**
 * Admin dashboard. Layout mirrors
 * `jp-design-system/ui_kits/admin/screens.jsx` DashboardScreen:
 *
 *   - Greeting block (date + "Good morning, {Name}")
 *   - 4-column stats grid
 *   - 2-col lower section: attendance bar chart placeholder +
 *     awaiting-approval panel
 *
 * Real data hooks land per-feature step (attendance step fills the
 * chart, enrolments step fills the approvals).
 */

import { CheckCircle2, Flame, GraduationCap, Sparkles } from 'lucide-react';

import { LiveActivityCard } from '@/components/admin/LiveActivityCard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { readSessionUser } from '@/lib/auth-cookies';

const STATS = [
  {
    label: 'Active students',
    value: '1,248',
    delta: '+18 this week',
    icon: GraduationCap,
  },
  {
    label: 'Attendance',
    value: '89%',
    delta: 'rolling 7 days',
    icon: CheckCircle2,
  },
  {
    label: 'Punya awarded',
    value: '14,820',
    delta: 'this month',
    icon: Sparkles,
  },
  {
    label: 'Pending approvals',
    value: '7',
    delta: 'enrolments + niyams',
    icon: Flame,
  },
];

const PENDING = [
  { kind: 'Enrolment', name: 'Aarav Shah', centre: 'Vasna', when: '2h ago' },
  { kind: 'Niyam submission', name: 'Aarush Mehta', centre: 'Bopal', when: '5h ago' },
  { kind: 'Niyam submission', name: 'Diya Doshi', centre: 'Naranpura', when: '1d ago' },
  { kind: 'Centre holiday', name: 'Maninagar', centre: '—', when: '2d ago' },
];

function todayString(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default async function AdminDashboard() {
  const user = await readSessionUser();
  const firstName = (user?.full_name ?? '').split(/\s+/)[0] || 'there';

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
          {STATS.map((s) => {
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
            <CardTitle>Attendance — last 7 days</CardTitle>
            <CardDescription>Per-centre check-in rates across your scope.</CardDescription>
          </CardHeader>
          <CardContent className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            Chart lands with the analytics step.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Awaiting your approval</CardTitle>
            <CardDescription>Top of the queue right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {PENDING.map((p, i) => (
              <div key={`${p.kind}-${i}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.kind} {p.centre !== '—' ? `· ${p.centre}` : ''}
                    </div>
                  </div>
                  <Badge variant="warning">{p.when}</Badge>
                </div>
                {i < PENDING.length - 1 ? <Separator className="mt-3" /> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Step 12 — live activity over Socket.IO. Subscribes to the
          /admin-dashboard/:cityId namespace and renders the last 20 events. */}
      <section>
        <LiveActivityCard />
      </section>
    </div>
  );
}
