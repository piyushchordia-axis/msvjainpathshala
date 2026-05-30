/** Public notices feed (SPEC §6.26) — reads @Public GET /v1/notices/public. */

import { Card } from '@/components/ui/card';

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

async function fetchNotices(): Promise<NoticeItem[]> {
  const base = process.env.NEXT_INTERNAL_API_BASE_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/v1/notices/public?limit=50`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { items?: NoticeItem[] } };
    return json.data?.items ?? [];
  } catch {
    return [];
  }
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function NoticesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const hi = locale === 'hi';
  const items = await fetchNotices();

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
      <div className="mt-10 grid gap-4">
        {items.length === 0 ? (
          <Card className="p-6 text-muted-foreground">
            {hi ? 'अभी कोई सार्वजनिक सूचना नहीं है।' : 'No public notices right now.'}
          </Card>
        ) : (
          items.map((n) => {
            const title = (hi ? n.title_hi : n.title_en) ?? n.title_en ?? n.title_hi ?? null;
            const body = (hi ? n.content_hi : n.content_en) ?? n.content_en ?? n.content_hi ?? '';
            return (
              <Card key={n.id} className="p-6">
                <div className="flex flex-wrap items-center gap-2">
                  {n.pinned ? (
                    <span className="rounded-pill bg-saffron-50 px-2 py-0.5 text-xs font-semibold text-saffron-700">
                      {hi ? 'पिन किया' : 'Pinned'}
                    </span>
                  ) : null}
                  {n.is_critical ? (
                    <span className="rounded-pill bg-status-error-soft px-2 py-0.5 text-xs font-semibold text-destructive">
                      {hi ? 'महत्वपूर्ण' : 'Important'}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{fmtDate(n.created_at)}</span>
                </div>
                {title ? (
                  <h2 className="mt-2 font-display text-xl text-secondary">{title}</h2>
                ) : null}
                <p className="mt-2 whitespace-pre-line text-muted-foreground">{body}</p>
              </Card>
            );
          })
        )}
      </div>
    </section>
  );
}
