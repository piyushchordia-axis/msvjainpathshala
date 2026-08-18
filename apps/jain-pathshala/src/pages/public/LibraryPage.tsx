import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Lock } from 'lucide-react';
import type { LibrarySectionDto } from '@workspace/api-zod';
import { t } from '@workspace/i18n';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { safeHref } from '@/lib/safe-url';
import { fetchLibrarySections } from '@/lib/library-cache';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';

function pickName(hi: boolean, s: LibrarySectionDto): string {
  if (hi) return s.name_hi || s.name_en || s.name_gu || '';
  return s.name_en || s.name_hi || s.name_gu || '';
}

function sectionDestination(section: LibrarySectionDto): string | null {
  // §17.11.1 — granth opens the SAME section screen, which draws the two-tab
  // shell off the type. A separate route would fork the item_list rules
  // §17.11.2 requires be shared exactly.
  if (section.type === 'item_list' || section.type === 'granth') {
    return `/library/${section.id}`;
  }
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
  // U-19 — `user` is null on first paint while the provider reads the session
  // cookie. Fetching before that drew the guest tree (lock icons) at a signed-in
  // member and then re-fetched the whole corpus. `loading` was already here.
  const { user, loading: authLoading } = useAuth();
  const authed = !!user;
  const [, navigate] = useLocation();
  const [sections, setSections] = useState<LibrarySectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Shared session cache — the tree carries every item's full text, and each
    // library page used to re-download the whole corpus (GST-PRF-01).
    fetchLibrarySections(authed, { force: reloadKey > 0 })
      .then((sections) => {
        if (!cancelled) {
          setSections(sections.filter((s) => !(authed && s.key === "pathshala_join")));
        }
      })
      .catch(() => {
        // Raw "Library request failed (502)" told a Hindi guest nothing they
        // could act on (GST-DSN-03) — the error card owns the copy now.
        if (!cancelled) {
          setError('load');
          setSections([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authed, authLoading, reloadKey]);

  function openSection(section: LibrarySectionDto) {
    // Panchang is never login-gated.
    const needsLogin = section.requires_login && !authed && section.type !== 'panchang';
    if (needsLogin) {
      const dest = sectionDestination(section) ?? `/library/${section.id}`;
      navigate(`/login?return=${encodeURIComponent(dest)}`);
      return;
    }

    if (section.type === 'item_list' || section.type === 'granth') {
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
      <p className="text-sm font-medium uppercase leading-6 tracking-[0.18em] text-primary">
        {hi ? 'पुस्तकालय' : 'Library'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'डिजिटल पुस्तकालय' : 'Digital library'}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        {hi
          ? 'ग्रंथ, स्तवन और संसाधन — अधिकतर सामग्री बिना साइन इन के उपलब्ध।'
          : 'Scriptures, stavans and resources — most content is open without signing in.'}
      </p>

      {error ? (
        <GuestError
          hi={hi}
          what="the library"
          whatHi="पुस्तकालय"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : authLoading || loading ? (
        <GuestLoading hi={hi} />
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
                    <span className="mt-2 text-xs leading-6 text-muted-foreground">
                      {hi
                        ? 'साइन इन करें — इस खंड की सामग्री सदस्यों के लिए है।'
                        : 'Sign in to open — this section is for members.'}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        §17.10.1 entry point. Below the sections, not above them: this is what
        you reach for after looking and not finding. Open to guests, like the
        form itself — no sign-in gate (Q13).
      */}
      <Card className="mt-10 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="font-display text-lg text-secondary">
            {t('libraryRequests.action', locale)}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t('libraryRequests.actionHint', locale)}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/library/request">{t('libraryRequests.action', locale)}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/library/my-requests">{t('libraryRequests.viewMine', locale)}</Link>
          </Button>
        </div>
      </Card>

      {!authed ? (
        <p className="mt-8 text-sm leading-6 text-muted-foreground">
          {hi ? 'पहले से सदस्य हैं? ' : 'Already a member? '}
          <Link href="/login?return=%2Flibrary" className="font-medium text-primary underline-offset-4 hover:underline">
            {hi ? 'साइन इन करें' : 'Sign in'}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
