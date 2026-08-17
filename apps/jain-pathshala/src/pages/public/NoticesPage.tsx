import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';

interface NoticeItem {
  id: string;
  title_en?: string | null;
  title_hi?: string | null;
  content_en?: string | null;
  content_hi?: string | null;
  pinned?: boolean;
  is_critical?: boolean;
  created_at?: string;
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function NoticesPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const [items, setItems] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    fetch('/v1/notices/public?limit=50', { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error('http');
        return r.json();
      })
      .then((json: { data?: { items?: NoticeItem[] } }) => {
        if (active) setItems(json.data?.items ?? []);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
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
              const title =
                (hi ? n.title_hi : n.title_en) ?? n.title_en ?? n.title_hi ?? null;
              const body =
                (hi ? n.content_hi : n.content_en) ?? n.content_en ?? n.content_hi ?? '';
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
                    <span className="text-xs text-muted-foreground">{fmtDate(n.created_at)}</span>
                  </div>
                  {title ? (
                    <h2 className="mt-3 font-display text-xl text-secondary">{title}</h2>
                  ) : null}
                  {body ? <p className="mt-2 text-sm text-muted-foreground">{body}</p> : null}
                </Card>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
