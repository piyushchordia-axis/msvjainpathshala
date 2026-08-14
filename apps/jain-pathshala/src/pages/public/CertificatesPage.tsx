/**
 * Parent/student course certificates — same list as mobile /certificates.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Award } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { apiGet } from '@/lib/api-client';

interface ChildOption {
  id: string;
  full_name: string;
}

interface CertificateRow {
  id: string;
  kind: string;
  title_en: string;
  title_hi: string | null;
  issued_at: string;
  status: string;
  pdf_url: string | null;
  verification_code: string;
  honorific_en: string | null;
  honorific_hi: string | null;
}

export default function CertificatesPage() {
  const hi = useLocale() === 'hi';
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const canView = user?.role === 'parent' || user?.role === 'student';

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [items, setItems] = useState<CertificateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) {
      setChildren([]);
      setStudentId(null);
      return;
    }
    let cancelled = false;
    apiGet<{ items: ChildOption[] }>('/v1/me/children')
      .then((res) => {
        if (cancelled) return;
        const list = res.items ?? [];
        setChildren(list);
        setStudentId((prev) =>
          prev && list.some((c) => c.id === prev) ? prev : (list[0]?.id ?? null),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setChildren([]);
          setStudentId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  useEffect(() => {
    if (!studentId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<{ items: CertificateRow[] }>(`/v1/students/${studentId}/certificates`)
      .then((res) => {
        if (!cancelled) setItems(res.items ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load certificates.');
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (authLoading) {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="container py-12 md:py-16">
        <h1 className="font-display text-3xl text-secondary">
          {hi ? 'प्रमाणपत्र' : 'Certificates'}
        </h1>
        <p className="mt-4 text-muted-foreground">
          {hi ? 'प्रमाणपत्र देखने के लिए साइन इन करें।' : 'Sign in to view certificates.'}
        </p>
        <Button
          className="mt-6"
          onClick={() => navigate('/login?return=%2Fcertificates')}
        >
          {hi ? 'साइन इन करें' : 'Sign in'}
        </Button>
      </section>
    );
  }

  return (
    <section className="container py-12 md:py-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/courses" className="text-sm text-muted-foreground hover:text-primary">
            ← {hi ? 'पाठ्यक्रम' : 'Courses'}
          </Link>
          <h1 className="mt-4 font-display text-3xl text-secondary md:text-4xl">
            {hi ? 'प्रमाणपत्र' : 'Certificates'}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {hi ? 'प्रमाणित अनुभाग और पाठ्यक्रम' : 'Certified sections and courses'}
          </p>
        </div>
      </div>

      {children.length > 1 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {children.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => setStudentId(child.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                studentId === child.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground'
              }`}
            >
              {child.full_name}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-8 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      ) : error ? (
        <Card className="mt-8 border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : items.length === 0 ? (
        <Card className="mt-8 p-6 text-muted-foreground">
          {hi
            ? 'अभी कोई प्रमाणपत्र नहीं। प्रमाणित अनुभाग यहाँ दिखेंगे।'
            : 'No certificates yet. Certified sections will appear here.'}
        </Card>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {items.map((row) => (
            <li key={row.id}>
              <Card className="flex h-full flex-col gap-2 p-5">
                <div className="flex items-start gap-2">
                  <Award className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
                  <p className="font-display text-lg text-secondary">
                    {hi ? row.title_hi || row.title_en : row.title_en}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {hi ? row.honorific_hi || 'प्रमाणित' : row.honorific_en || 'Certified'}
                  {' · '}
                  {new Date(row.issued_at).toLocaleDateString(hi ? 'hi-IN' : 'en-GB')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {hi ? 'सत्यापन कोड' : 'Verification code'}: {row.verification_code}
                </p>
                {row.pdf_url ? (
                  <a
                    href={row.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto text-sm text-primary hover:underline"
                  >
                    {hi ? 'PDF खोलें' : 'Open PDF'}
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {row.status === 'issuing'
                      ? hi
                        ? 'PDF बन रहा है…'
                        : 'PDF is still issuing…'
                      : hi
                        ? 'PDF उपलब्ध नहीं'
                        : 'PDF not available'}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
