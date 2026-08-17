/**
 * MSV programme — apply and track status (web parent/student surface, /my-msv).
 *
 * Distinct from the guest-facing `/msv` info page: this one requires a parent or
 * student session, and follows the app's existing `/my-requests` convention for
 * member-only pages.
 *
 * `POST /v1/msv/apply` and `GET /v1/msv/mine` were built and guarded but had no
 * client at all. The mobile screen landed first; this is the web half, so a
 * parent who does everything in a browser is not shut out of the programme.
 *
 * Q1 — approval is purely admin discretion: no eligibility check, age gate or
 * score threshold here. The form submits and shows the admin's decision.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Award } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from '@/components/ui/toast-jp';

interface MsvEnrolment {
  id: string;
  status: string;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
}

interface MsvChild {
  id: string;
  full_name: string;
  student_code: string;
  msv_status: string | null;
  latest_enrolment: MsvEnrolment | null;
  msv_curriculum: { id: string; name: string; academic_year: string } | null;
}

function statusLabel(status: string | null | undefined, hi: boolean): string {
  switch (status) {
    case 'approved':
      return hi ? 'स्वीकृत' : 'Approved';
    case 'applied':
      return hi ? 'विचाराधीन' : 'Under review';
    case 'waitlisted':
      return hi ? 'प्रतीक्षा सूची' : 'Waitlisted';
    case 'rejected':
      return hi ? 'अस्वीकृत' : 'Not accepted';
    case 'revoked':
      return hi ? 'वापस लिया गया' : 'Withdrawn';
    default:
      return hi ? 'आवेदन नहीं किया' : 'Not applied';
  }
}

function statusClass(status: string | null | undefined): string {
  switch (status) {
    case 'approved':
      return 'bg-status-success-soft text-status-success';
    case 'rejected':
      return 'bg-status-error-soft text-status-error';
    case 'applied':
    case 'waitlisted':
      return 'bg-status-warning-soft text-status-warning';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export default function MyMsvPage() {
  const hi = useLocale() === 'hi';
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const canView = user?.role === 'parent' || user?.role === 'student';

  const [items, setItems] = useState<MsvChild[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canView) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    apiGet<{ items: MsvChild[] }>('/v1/msv/mine')
      .then((res) => setItems(res.items ?? []))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : hi
              ? 'जानकारी लोड नहीं हो सकी।'
              : 'Could not load MSV details.',
        ),
      )
      .finally(() => setLoading(false));
  }, [canView, hi]);

  useEffect(() => {
    load();
  }, [load]);

  async function apply(child: MsvChild) {
    setBusyId(child.id);
    try {
      await apiPost('/v1/msv/apply', { student_id: child.id });
      toast.success(
        hi ? 'आवेदन भेजा गया' : 'Application sent',
        hi ? 'निर्णय आने पर यहाँ दिखेगा।' : 'The decision will appear here.',
      );
      load();
    } catch (err) {
      toast.error(
        hi ? 'आवेदन नहीं भेजा जा सका' : "Couldn't send the application",
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusyId(null);
    }
  }

  if (authLoading) {
    return <div className="py-16 text-center text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</div>;
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <h1 className="font-display text-3xl text-secondary">MSV</h1>
        <p className="mt-4 text-muted-foreground">
          {hi
            ? 'यह पृष्ठ अभिभावक और विद्यार्थी खातों के लिए है। कृपया साइन इन करें।'
            : 'This page is for parent and student accounts. Please sign in to continue.'}
        </p>
        <Button className="mt-6" onClick={() => navigate('/login?return=/my-msv')}>
          {hi ? 'साइन इन करें' : 'Sign in'}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">
            {hi ? 'कार्यक्रम' : 'Programme'}
          </p>
          <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
            MSV
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            {hi
              ? 'आवेदन करें और स्थिति देखें। स्वीकृति व्यवस्थापक के विवेक पर है।'
              : 'Apply and track your status. Acceptance is at the administrator’s discretion.'}
          </p>
        </div>
      </div>

      {error ? (
        <Card className="mt-10 border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>
            {hi ? 'पुनः प्रयास करें' : 'Try again'}
          </Button>
        </Card>
      ) : loading ? (
        <div className="mt-10 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</div>
      ) : items.length === 0 ? (
        <Card className="mt-10 p-6 text-sm text-muted-foreground">
          {hi ? 'कोई बच्चा नहीं मिला।' : 'No children found on your account.'}
        </Card>
      ) : (
        <div className="mt-10 space-y-4">
          {items.map((child) => {
            const enrolment = child.latest_enrolment;
            const status = child.msv_status ?? enrolment?.status ?? null;
            // Re-application is allowed from these states (server-enforced).
            const canApply = !status || ['rejected', 'revoked', 'waitlisted', 'none'].includes(status);
            return (
              <Card key={child.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl text-secondary">{child.full_name}</h2>
                    <p className="font-mono text-xs text-muted-foreground">{child.student_code}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${statusClass(status)}`}
                  >
                    {statusLabel(status, hi)}
                  </span>
                </div>

                {enrolment ? (
                  <p className="mt-4 text-xs text-muted-foreground">
                    {hi ? 'आवेदन तिथि: ' : 'Applied: '}
                    {new Date(enrolment.created_at).toLocaleDateString(hi ? 'hi-IN' : 'en-GB')}
                  </p>
                ) : null}

                {/* The admin's own words, where they gave a reason. */}
                {enrolment?.reason ? (
                  <p className="mt-2 text-sm">
                    {hi ? 'टिप्पणी: ' : 'Note: '}
                    {enrolment.reason}
                  </p>
                ) : null}

                {child.msv_curriculum ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Award className="h-3.5 w-3.5" aria-hidden />
                    {child.msv_curriculum.name} · {child.msv_curriculum.academic_year}
                  </p>
                ) : null}

                {canApply ? (
                  <Button
                    className="mt-5"
                    disabled={busyId === child.id}
                    onClick={() => void apply(child)}
                  >
                    {busyId === child.id
                      ? hi
                        ? 'भेजा जा रहा है…'
                        : 'Sending…'
                      : hi
                        ? 'MSV के लिए आवेदन करें'
                        : 'Apply for MSV'}
                  </Button>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
