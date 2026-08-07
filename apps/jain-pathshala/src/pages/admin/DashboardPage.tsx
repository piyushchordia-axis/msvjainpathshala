import { useEffect, useState } from 'react';
import { CheckCircle2, Flame, GraduationCap, Sparkles } from 'lucide-react';
import { t } from '@workspace/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { apiGet } from '@/lib/api-client';

interface OverviewPayload {
  active_students: number;
  centres: number;
  open_service_requests: number;
  pending_enrolments: number;
  attendance_rate_30d: number;
  punya_awarded_30d: number;
  msv_active: number;
  /** Absent for roles outside DONATION_VIEW_ROLES (sanchalak, shikshak). */
  donations_total_paise_ytd?: number;
}

interface EnrolmentRow { id: string; created_at: string; }

function todayString() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const EMPTY: OverviewPayload = {
  active_students: 0,
  centres: 0,
  open_service_requests: 0,
  pending_enrolments: 0,
  attendance_rate_30d: 0,
  punya_awarded_30d: 0,
  msv_active: 0,
};

export default function DashboardPage() {
  const { user } = useAuth();
  const locale = useLocale();
  const firstName = (user?.full_name ?? '').split(/\s+/)[0] || 'there';

  const [overview, setOverview] = useState<OverviewPayload>(EMPTY);
  const [pending, setPending] = useState<EnrolmentRow[]>([]);

  useEffect(() => {
    apiGet<OverviewPayload>('/v1/admin/analytics/overview')
      .then((r) => setOverview(r ?? EMPTY))
      .catch(() => {});
    apiGet<{ items: EnrolmentRow[] }>('/v1/admin/enrolments?status=pending&limit=8')
      .then((r) => setPending(r?.items ?? []))
      .catch(() => {});
  }, []);

  const stats = [
    { label: 'Active students', value: overview.active_students.toLocaleString('en-IN'), delta: `${overview.centres} centres in scope`, icon: GraduationCap },
    { label: '30-day attendance', value: `${overview.attendance_rate_30d.toFixed(1)}%`, delta: 'rolling window', icon: CheckCircle2 },
    { label: 'Punya awarded', value: overview.punya_awarded_30d.toLocaleString('en-IN'), delta: 'this month', icon: Sparkles },
    { label: 'Pending enrolments', value: overview.pending_enrolments.toLocaleString('en-IN'), delta: 'awaiting your approval', icon: Flame },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{todayString()}</div>
        <h2 className="mt-1 font-display text-3xl text-secondary">Jai Jinendra, {firstName}</h2>
        <p className="text-sm text-muted-foreground">Here's a snapshot of what's waiting for you.</p>
      </div>

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
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</div>
                  <div className="mt-1 font-mono text-2xl leading-none text-secondary">{s.value}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{s.delta}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>In your scope</CardTitle>
            <CardDescription>Live totals across the centres you oversee.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {[
                { label: 'Centres', value: overview.centres },
                { label: 'MSV approved', value: overview.msv_active },
                { label: t('requests.kpiOpen', locale), value: overview.open_service_requests },
                { label: 'Pending enrolments', value: overview.pending_enrolments },
                // Only present for city_admin and above — the API omits it for scoped roles.
                ...(overview.donations_total_paise_ytd === undefined
                  ? []
                  : [{
                      label: 'Donations YTD',
                      value: `₹${(overview.donations_total_paise_ytd / 100).toLocaleString('en-IN')}`,
                    }]),
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-mono text-2xl leading-none text-secondary">{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Awaiting your approval</CardTitle>
            <CardDescription>Pending enrolment requests in your scope.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing waiting right now — you're all caught up.</p>
            ) : (
              pending.map((p, i) => (
                <div key={p.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">Enrolment request</div>
                      <div className="truncate text-xs text-muted-foreground">Review under Enrolments</div>
                    </div>
                    <Badge variant="secondary">{timeAgo(p.created_at)}</Badge>
                  </div>
                  {i < pending.length - 1 ? <Separator className="mt-3" /> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
