import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Lock } from 'lucide-react';
import type { LibrarySectionDto } from '@workspace/api-zod';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { apiGet } from '@/lib/api-client';
import { safeHref } from '@/lib/safe-url';

function pickName(hi: boolean, s: LibrarySectionDto): string {
  if (hi) return s.name_hi || s.name_en || s.name_gu || '';
  return s.name_en || s.name_hi || s.name_gu || '';
}

function sectionDestination(section: LibrarySectionDto): string | null {
  if (section.type === 'item_list') return `/library/${section.id}`;
  if (section.type === 'panchang') return '/panchang';
  if (section.type === 'deeplink') {
    const t = section.deeplink_target?.trim();
    if (t?.startsWith('/') && !t.startsWith('//')) return t;
  }
  return null;
}

export default function LibraryPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const { user } = useAuth();
  const authed = !!user;
  const [, navigate] = useLocation();
  const [sections, setSections] = useState<LibrarySectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = authed
      ? apiGet<{ sections: LibrarySectionDto[] }>('/v1/library')
      : fetch('/v1/public/library', { headers: { Accept: 'application/json' } })
          .then(async (r) => {
            if (!r.ok) {
              throw new Error(`Library request failed (${r.status})`);
            }
            return r.json();
          })
          .then((json: { data?: { sections?: LibrarySectionDto[] } }) => ({
            sections: json.data?.sections ?? [],
          }));

    Promise.resolve(load)
      .then((res) => {
        if (!cancelled) setSections(res?.sections ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the library.');
          setSections([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authed]);

  function openSection(section: LibrarySectionDto) {
    // Panchang is never login-gated.
    const needsLogin = section.requires_login && !authed && section.type !== 'panchang';
    if (needsLogin) {
      const dest = sectionDestination(section) ?? `/library/${section.id}`;
      navigate(`/login?return=${encodeURIComponent(dest)}`);
      return;
    }

    if (section.type === 'item_list') {
      navigate(`/library/${section.id}`);
      return;
    }
    if (section.type === 'panchang') {
      navigate('/panchang');
      return;
    }
    if (section.type === 'deeplink') {
      const target = section.deeplink_target?.trim();
      if (!target) return;
      if (target.startsWith('/')) {
        navigate(target);
        return;
      }
      const safe = safeHref(target);
      if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'पुस्तकालय' : 'Library'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'डिजिटल पुस्तकालय' : 'Digital library'}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        {hi
          ? 'ग्रंथ, स्तवन और संसाधन — अधिकतर सामग्री बिना लॉगिन के उपलब्ध।'
          : 'Scriptures, stavans and resources — most content is open without signing in.'}
      </p>

      {error ? (
        <Card className="mt-10 border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : loading ? (
        <div className="mt-10 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</div>
      ) : sections.length === 0 ? (
        <Card className="mt-10 p-6 text-muted-foreground">
          {hi ? 'अभी कोई खंड नहीं है।' : 'No sections available yet.'}
        </Card>
      ) : (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((section) => {
            const title = pickName(hi, section);
            const showLock =
              section.requires_login && !authed && section.type !== 'panchang';
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => openSection(section)}
                  className="flex w-full flex-col rounded-lg border border-border bg-card p-5 text-left transition hover:border-primary/40"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-display text-lg text-secondary">{title}</span>
                    {showLock ? (
                      <Lock className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                  </span>
                  {showLock ? (
                    <span className="mt-2 text-xs text-muted-foreground">
                      {hi ? 'लॉगिन आवश्यक' : 'Sign in required'}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!authed ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {hi ? 'पहले से सदस्य हैं? ' : 'Already a member? '}
          <Link href="/login?return=%2Flibrary" className="font-medium text-primary underline-offset-4 hover:underline">
            {hi ? 'साइन इन करें' : 'Sign in'}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
