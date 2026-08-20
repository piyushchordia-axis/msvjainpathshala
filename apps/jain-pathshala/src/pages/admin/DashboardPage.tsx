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
  punya_awarded_month: number;
  msv_active: number;
  /** Absent for roles outside DONATION_VIEW_ROLES (sanchalak, shikshak). */
  donations_total_paise_ytd?: number;
}

interface EnrolmentRow {
  id: string;
  created_at: string;
  student_name?: string | null;
  student_code?: string | null;
  batch_name?: string | null;
}

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
  punya_awarded_month: 0,
  msv_active: 0,
};

export default function DashboardPage() {
  const { user } = useAuth();
  const locale = useLocale();
  const firstName = (user?.full_name ?? '').split(/\s+/)[0] || 'there';

  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [pending, setPending] = useState<EnrolmentRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    // A failed load must say so — the old empty catches rendered the all-zero
    // EMPTY constant as confident real stats (SAN-ERR-01).
    apiGet<OverviewPayload>('/v1/admin/analytics/overview')
      .then((r) => {
        if (!cancelled) setOverview(r ?? EMPTY);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    apiGet<{ items: EnrolmentRow[] }>('/v1/admin/enrolments?status=pending&limit=8')
      .then((r) => {
        if (!cancelled) setPending(r?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const data = overview ?? EMPTY;
  const stats = [
    { label: 'Active students', value: data.active_students.toLocaleString('en-IN'), delta: `${data.centres} centres in scope`, icon: GraduationCap },
    { label: '30-day attendance', value: `${data.attendance_rate_30d.toFixed(1)}%`, delta: 'rolling window', icon: CheckCircle2 },
    { label: 'Punya awarded', value: data.punya_awarded_month.toLocaleString('en-IN'), delta: 'this month', icon: Sparkles },
    { label: 'Pending enrolments', value: data.pending_enrolments.toLocaleString('en-IN'), delta: 'awaiting your approval', icon: Flame },
  ];

  if (loadError) {
    return (
      <div className="space-y-6">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{todayString()}</div>
          <h2 className="mt-1 font-display text-3xl text-secondary">Jai Jinendra, {firstName}</h2>
        </div>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-destructive">
              Couldn't load your dashboard — these numbers are unavailable, not zero.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check your connection and try again.
            </p>
            <button
              type="button"
              className="mt-4 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-secondary hover:border-primary/40"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Try again
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
                { label: 'Centres', value: data.centres },
                { label: 'MSV approved', value: data.msv_active },
                { label: t('requests.kpiOpen', locale), value: data.open_service_requests },
                { label: 'Pending enrolments', value: data.pending_enrolments },
                // Only present for city_admin and above — the API omits it for scoped roles.
                ...(data.donations_total_paise_ytd === undefined
                  ? []
                  : [{
                      label: 'Donations YTD',
                      value: `₹${(data.donations_total_paise_ytd / 100).toLocaleString('en-IN')}`,
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
                      {/* The API already returns these — identical anonymous
                          "Enrolment request" rows told the sanchalak nothing
                          (SAN-DSN-04). */}
                      <div className="truncate text-sm font-medium text-foreground">
                        {p.student_name || 'Enrolment request'}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[p.student_code, p.batch_name].filter(Boolean).join(' · ') ||
                          'Review under Enrolments'}
                      </div>
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
