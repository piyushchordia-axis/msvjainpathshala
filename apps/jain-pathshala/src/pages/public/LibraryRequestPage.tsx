/**
 * Library content request form — Section 17 v3 §17.10.
 *
 * One form behind every entry point (library home, a section detail). The
 * section arrives as `?section=<id>` and a prefilled title as `?title=<text>`,
 * rather than three near-identical pages.
 *
 * Open to guests: no sign-in gate and no `requires_login` check here by design
 * (Q13). A signed-out visitor supplies the name and phone a member's profile
 * already carries.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearch, Link } from 'wouter';
import { CloudOff, CheckCircle2, Send } from 'lucide-react';
import type { LibrarySectionDto } from '@workspace/api-zod';
import { t, type Locale } from '@workspace/i18n';

import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { fetchLibrarySections } from '@/lib/library-cache';
import { submitLibraryRequest } from '@/lib/library-requests';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function tr(locale: Locale, key: string): string {
  return t(`libraryRequests.${key}`, locale);
}

/** "Other" is a sentinel in the picker, never a section id. */
const OTHER = '__other__';

/** Live connectivity — the form is replaced, not disabled, when offline (§17.4). */
function useIsOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export default function LibraryRequestPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const { user } = useAuth();
  const authed = !!user;
  const online = useIsOnline();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const [sections, setSections] = useState<LibrarySectionDto[]>([]);
  const [sectionChoice, setSectionChoice] = useState<string>(params.get('section') ?? '');
  const [suggestedSection, setSuggestedSection] = useState('');
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [details, setDetails] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [name, setName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  // The picker lists published sections only — the same tree the visitor just
  // browsed, so a section they cannot see is never offered.
  useEffect(() => {
    let cancelled = false;
    fetchLibrarySections(authed)
      .then((rows) => {
        if (!cancelled) setSections(rows.filter((s) => s.type !== 'deeplink'));
      })
      .catch(() => {
        if (!cancelled) setSections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  function sectionName(s: LibrarySectionDto): string {
    return (hi ? s.name_hi || s.name_en : s.name_en || s.name_hi) ?? '';
  }

  /** Mirrors the server contract so the visitor is told before a round trip. */
  function validate(): string | null {
    if (!sectionChoice) return tr(locale, 'errSectionRequired');
    if (sectionChoice === OTHER && suggestedSection.trim().length === 0) {
      return tr(locale, 'errSuggestedRequired');
    }
    if (title.trim().length === 0) return tr(locale, 'errTitleRequired');
    if (details.trim().length < 20) return tr(locale, 'errDetailsShort');
    const url = referenceUrl.trim();
    if (url.length > 0 && !/^https?:\/\/\S+$/i.test(url)) return tr(locale, 'errReferenceUrl');
    if (name.trim().length === 0) return tr(locale, 'errNameRequired');
    if (!/^\d{10}$/.test(phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))) {
      return tr(locale, 'errPhoneRequired');
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validate();
    setProblem(found);
    if (found) return;
    setSubmitting(true);
    try {
      const other = sectionChoice === OTHER;
      await submitLibraryRequest({
        section_id: other ? null : sectionChoice,
        suggested_section: other ? suggestedSection.trim() : null,
        title: title.trim(),
        details: details.trim(),
        reference_url: referenceUrl.trim() || null,
        requester_name: name.trim(),
        requester_phone: phone.trim(),
      });
      setSent(true);
    } catch (err) {
      setProblem(submitErrorCopy(err, locale));
    } finally {
      setSubmitting(false);
    }
  }

  /* Offline: explain, never present a submit button that cannot work (§17.4). */
  if (!online) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <CloudOff className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <h1 className="text-lg font-semibold">{tr(locale, 'offlineTitle')}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{tr(locale, 'offlineBody')}</p>
            </div>
          </div>
          <div className="mt-6">
            <Button variant="outline" onClick={() => navigate('/library')}>
              {tr(locale, 'cancel')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <h1 className="text-lg font-semibold">{tr(locale, 'successTitle')}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{tr(locale, 'successBody')}</p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => navigate('/library')}>
              {tr(locale, 'cancel')}
            </Button>
            <Button onClick={() => navigate('/library/my-requests')}>
              {tr(locale, 'viewMine')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">{tr(locale, 'formTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{tr(locale, 'formIntro')}</p>

        <form className="mt-6 space-y-5" onSubmit={submit} noValidate>
          <div className="space-y-2">
            <Label htmlFor="lr-section">{tr(locale, 'sectionLabel')}</Label>
            <Select value={sectionChoice} onValueChange={setSectionChoice}>
              <SelectTrigger id="lr-section">
                <SelectValue placeholder={tr(locale, 'sectionPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {sectionName(s)}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>{tr(locale, 'sectionOther')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {sectionChoice === OTHER ? (
            <div className="space-y-2">
              <Label htmlFor="lr-suggested">{tr(locale, 'suggestedSectionLabel')}</Label>
              <Input
                id="lr-suggested"
                value={suggestedSection}
                onChange={(e) => setSuggestedSection(e.target.value)}
                placeholder={tr(locale, 'suggestedSectionPlaceholder')}
                maxLength={200}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="lr-title">{tr(locale, 'titleLabel')}</Label>
            <Input
              id="lr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={tr(locale, 'titlePlaceholder')}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lr-details">{tr(locale, 'detailsLabel')}</Label>
            <Textarea
              id="lr-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={tr(locale, 'detailsPlaceholder')}
              rows={5}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground">{tr(locale, 'detailsHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lr-url">{tr(locale, 'referenceLabel')}</Label>
            <Input
              id="lr-url"
              type="url"
              inputMode="url"
              value={referenceUrl}
              onChange={(e) => setReferenceUrl(e.target.value)}
              placeholder={tr(locale, 'referencePlaceholder')}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">{tr(locale, 'referenceHint')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lr-name">{tr(locale, 'nameLabel')}</Label>
              <Input
                id="lr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tr(locale, 'namePlaceholder')}
                maxLength={200}
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lr-phone">{tr(locale, 'phoneLabel')}</Label>
              <Input
                id="lr-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={tr(locale, 'phonePlaceholder')}
                maxLength={20}
                autoComplete="tel"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{tr(locale, 'contactHint')}</p>

          {problem ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {problem}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting}>
              <Send className="mr-2 h-4 w-4" aria-hidden />
              {submitting ? tr(locale, 'submitting') : tr(locale, 'submit')}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/library')}>
              {tr(locale, 'cancel')}
            </Button>
            <Link href="/library/my-requests" className="text-sm text-primary underline-offset-4 hover:underline">
              {tr(locale, 'viewMine')}
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}

/**
 * Server outcomes the visitor can act on. The 429 and 409 caps are ordinary
 * results of using the form, not faults — they get copy that says what happened
 * and what to do, never a raw code.
 */
function submitErrorCopy(err: unknown, locale: Locale): string {
  if (err instanceof ApiError) {
    if (err.code === 'ERR_LIBRARY_REQUEST_RATE_LIMITED') return tr(locale, 'errRateLimited');
    if (err.code === 'ERR_LIBRARY_REQUEST_PENDING_LIMIT') return tr(locale, 'errPendingLimit');
    if (err.code === 'ERR_NOT_FOUND') return tr(locale, 'errSectionGone');
  }
  return tr(locale, 'errGeneric');
}
