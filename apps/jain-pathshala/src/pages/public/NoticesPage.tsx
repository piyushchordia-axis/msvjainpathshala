import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';
import { apiGet } from '@/lib/api-client';

interface NoticeItem {
  id: string;
  title_en?: string | null;
  title_hi?: string | null;
  content_en?: string | null;
  content_hi?: string | null;
  pinned?: boolean;
  is_critical?: boolean;
  // G-1 (review 2026-08) — audience/centre_name let a centre-scoped notice
  // identify itself instead of appearing anonymous and national.
  audience?: string | null;
  centre_name?: string | null;
  // DB-11 — the feed sorts by published_at; render that, not created_at.
  published_at?: string | null;
  created_at?: string;
}

const PAGE_LIMIT = 50;

function fmtDate(iso: string | null | undefined, hi: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(hi ? 'hi-IN' : 'en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
}

/** G-1 — a centre/batch-scoped notice's audience label, so it never reads as anonymous/national. */
function audienceLabel(item: NoticeItem, hi: boolean): string | null {
  if (item.audience === 'centre' || item.audience === 'batch') {
    return item.centre_name ?? (hi ? 'केंद्र-विशिष्ट' : 'Centre-specific');
  }
  if (item.audience === 'state') return hi ? 'राज्य-स्तरीय' : 'State-wide';
  if (item.audience === 'city') return hi ? 'शहर-स्तरीय' : 'City-wide';
  if (item.audience === 'msv') return 'MSV';
  return null;
}

export default function NoticesPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const [items, setItems] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // G-7 — abort a fast retry's earlier in-flight request instead of racing it.
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    // G-2 — the shared client (envelope normalisation, request ids, auth
    // refresh) instead of a raw same-origin fetch — the only one left in the
    // web tree.
    apiGet<{ items?: NoticeItem[] }>(`/v1/notices/public?limit=${PAGE_LIMIT}`, {
      signal: controller.signal,
    })
      .then((data) => {
        setItems(data.items ?? []);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'सूचनाएँ' : 'Notices'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'सार्वजनिक सूचनाएँ' : 'Public notices'}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        {hi
          ? 'मेघ संस्कार वाटिका नेटवर्क की ताज़ा घोषणाएँ।'
          : 'The latest announcements from the Megh Sanskar Vatika network.'}
      </p>

      {loading ? (
        <GuestLoading hi={hi} />
      ) : error ? (
        <GuestError
          hi={hi}
          what="notices"
          whatHi="सूचनाएँ"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : (
        <div className="mt-10 grid gap-4">
          {items.length === 0 ? (
            <Card className="p-6 text-muted-foreground">
              {hi ? 'अभी कोई सार्वजनिक सूचना नहीं है।' : 'No public notices right now.'}
            </Card>
          ) : (
            items.map((n) => {
              // G-6 — `??` survives a stored empty string; `||` treats it the
              // same as "no title" like the heading guard below already does.
              const title = (hi ? n.title_hi : n.title_en) || n.title_en || n.title_hi || null;
              const body = (hi ? n.content_hi : n.content_en) || n.content_en || n.content_hi || '';
              const audience = audienceLabel(n, hi);
              return (
                <Card key={n.id} className="p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.pinned ? (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
                        {hi ? 'पिन किया' : 'Pinned'}
                      </span>
                    ) : null}
                    {n.is_critical ? (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                        {hi ? 'महत्वपूर्ण' : 'Important'}
                      </span>
                    ) : null}
                    {audience ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {audience}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(n.published_at ?? n.created_at, hi)}
                    </span>
                  </div>
                  {title ? (
                    <h2 className="mt-3 font-display text-xl text-secondary">{title}</h2>
                  ) : null}
                  {/* G-5 — the source is a multi-line textarea; without this the
                      newlines collapse into one run-on paragraph. */}
                  {body ? (
                    <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{body}</p>
                  ) : null}
                </Card>
              );
            })
          )}
          {/* G-3 — a silent 51st-notice cutoff looks identical to "that's everything".
              A cursor would be the complete fix; this at least tells the reader more exist. */}
          {items.length >= PAGE_LIMIT ? (
            <p className="pt-2 text-center text-xs text-muted-foreground">
              {hi
                ? `नवीनतम ${PAGE_LIMIT} सूचनाएँ दिखाई गई हैं।`
                : `Showing the latest ${PAGE_LIMIT} notices.`}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
