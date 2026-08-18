/**
 * My library requests — Section 17 v3 §17.10.4.
 *
 * Guests see their device-scoped list; a member sees theirs. After first login
 * the server has already re-keyed that device's rows to the account, so the
 * guest history simply appears — there is deliberately no "claim my requests"
 * button for the visitor to find and press.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Clock, Info } from 'lucide-react';
import { t, type Locale } from '@workspace/i18n';

import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import {
  fetchMyLibraryRequests,
  type LibraryContentRequest,
  type LibraryRequestStatus,
} from '@/lib/library-requests';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function tr(locale: Locale, key: string, vars?: Record<string, string>): string {
  return t(`libraryRequests.${key}`, locale, vars);
}

function statusLabel(status: LibraryRequestStatus, locale: Locale): string {
  if (status === 'accepted') return tr(locale, 'statusAccepted');
  if (status === 'rejected') return tr(locale, 'statusRejected');
  if (status === 'published') return tr(locale, 'statusPublished');
  return tr(locale, 'statusPending');
}

/**
 * Rejected is the only negative state and published the only success; pending
 * and accepted both read as "in hand", which is what they are.
 */
function statusVariant(status: LibraryRequestStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'published') return 'default';
  if (status === 'rejected') return 'outline';
  return 'secondary';
}

function formatDate(iso: string, hi: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(hi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function MyLibraryRequestsPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const { user } = useAuth();
  const [rows, setRows] = useState<LibraryContentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchMyLibraryRequests()
      .then(setRows)
      .catch(() => {
        setFailed(true);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Re-runs when the account changes, so signing in shows the re-keyed guest
  // history without the visitor doing anything.
  useEffect(load, [load, user?.id]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{tr(locale, 'myTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tr(locale, 'mySubtitle')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/library/request">{tr(locale, 'action')}</Link>
        </Button>
      </div>

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">{tr(locale, 'statusPendingHint')}</p>
      ) : failed ? (
        <Card className="mt-8 p-6">
          <p className="text-sm text-muted-foreground">{tr(locale, 'loadFailed')}</p>
          <Button className="mt-4" variant="outline" onClick={load}>
            {tr(locale, 'tryAgain')}
          </Button>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="mt-8 p-6">
          <p className="font-medium">{tr(locale, 'empty')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{tr(locale, 'emptyHint')}</p>
          <Button asChild className="mt-4">
            <Link href="/library/request">{tr(locale, 'action')}</Link>
          </Button>
        </Card>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((r) => {
            const section = hi
              ? r.section_name_hi || r.section_name_en
              : r.section_name_en || r.section_name_hi;
            return (
              <li key={r.id}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold">{r.title}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tr(locale, 'requestedOn', { date: formatDate(r.created_at, hi) })}
                        {section ? ` · ${section}` : ''}
                        {!section && r.suggested_section
                          ? ` · ${tr(locale, 'suggestedSectionChip', { name: r.suggested_section })}`
                          : ''}
                      </p>
                    </div>
                    <Badge variant={statusVariant(r.status)}>{statusLabel(r.status, locale)}</Badge>
                  </div>

                  <p className="mt-3 text-sm text-muted-foreground">{r.details}</p>

                  {r.admin_note ? (
                    <div className="mt-4 rounded-md bg-muted p-3">
                      <p className="text-xs text-muted-foreground">{tr(locale, 'adminNoteLabel')}</p>
                      <p className="mt-1 text-sm">{r.admin_note}</p>
                    </div>
                  ) : null}

                  {r.status === 'published' && r.linked_item_id ? (
                    <Button asChild variant="outline" size="sm" className="mt-4">
                      <Link href={`/library/item/${r.linked_item_id}`}>
                        {tr(locale, 'openItem')}
                      </Link>
                    </Button>
                  ) : (
                    <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                      {r.status === 'rejected' ? (
                        <Info className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {r.status === 'accepted'
                        ? tr(locale, 'statusAcceptedHint')
                        : r.status === 'pending'
                          ? tr(locale, 'statusPendingHint')
                          : ''}
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
