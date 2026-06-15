import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { safeHref } from '@/lib/safe-url';

type ContentType = 'pdf' | 'video' | 'audio' | 'image';
type AccessTier = 'public' | 'student' | 'msv' | 'shikshak';

interface LibraryItem {
  id: string;
  content_type: ContentType;
  title_en: string;
  title_hi?: string | null;
  description_en?: string | null;
  description_hi?: string | null;
  embed_url?: string | null;
  file_url?: string | null;
  /** Member feed returns a single resolved delivery URL; public feed does not. */
  url?: string | null;
  access_tier?: AccessTier;
}

const TYPE_LABEL: Record<string, string> = {
  pdf: 'PDF',
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
};

const TIER_LABEL: Record<AccessTier, { en: string; hi: string }> = {
  public: { en: 'Public', hi: 'सार्वजनिक' },
  student: { en: 'Members', hi: 'सदस्य' },
  msv: { en: 'MSV', hi: 'MSV' },
  shikshak: { en: 'Teachers', hi: 'शिक्षक' },
};

/** Per-content-type call-to-action label. */
function actionLabel(type: ContentType, hi: boolean): string {
  if (type === 'video') return hi ? 'देखें' : 'Watch';
  if (type === 'audio') return hi ? 'सुनें' : 'Listen';
  if (type === 'pdf') return hi ? 'पढ़ें' : 'Read';
  return hi ? 'खोलें' : 'Open';
}

/** Resolve the deliverable URL for an item (member `url`, else file/embed). */
function itemUrl(it: LibraryItem): string | undefined {
  return safeHref(it.url ?? it.file_url ?? it.embed_url ?? null);
}

function ResourceCard({
  it,
  hi,
  authed,
}: {
  it: LibraryItem;
  hi: boolean;
  authed: boolean;
}) {
  const title = (hi ? it.title_hi : it.title_en) ?? it.title_en;
  const desc = (hi ? it.description_hi : it.description_en) ?? it.description_en ?? '';
  const href = itemUrl(it);

  // For logged-in members we record the access (and re-resolve a fresh URL)
  // through the member endpoint; the link still works without JS as a fallback.
  async function handleOpen(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!authed) return; // public feed: plain link, nothing to log.
    try {
      const res = await apiPost<{ url?: string }>(`/v1/library/${it.id}/access`, {});
      if (res?.url) {
        const safe = safeHref(res.url);
        if (safe) {
          e.preventDefault();
          window.open(safe, '_blank', 'noopener,noreferrer');
        }
      }
    } catch (err) {
      // Non-fatal: the anchor's own href still navigates. Swallow logging errors.
      void (err instanceof ApiError ? err.code : err);
    }
  }

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-2">
        <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {TYPE_LABEL[it.content_type] ?? it.content_type}
        </span>
        {it.access_tier && it.access_tier !== 'public' ? (
          <span className="w-fit rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {hi ? TIER_LABEL[it.access_tier].hi : TIER_LABEL[it.access_tier].en}
          </span>
        ) : null}
      </div>
      <h2 className="mt-3 font-display text-lg text-secondary">{title}</h2>
      {desc ? <p className="mt-1 flex-1 text-sm text-muted-foreground">{desc}</p> : <div className="flex-1" />}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={handleOpen}
          className="mt-4 inline-flex w-fit rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {actionLabel(it.content_type, hi)}
        </a>
      ) : (
        <span className="mt-4 inline-flex w-fit text-xs text-muted-foreground">
          {hi ? 'सामग्री शीघ्र उपलब्ध होगी।' : 'Content coming soon.'}
        </span>
      )}
    </Card>
  );
}

export default function LibraryPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const { user } = useAuth();
  const authed = !!user;
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Logged-in members get the tiered feed WITH delivery URLs; everyone else
    // gets the public-only feed (embed_url only, no gated files).
    const load = authed
      ? apiGet<{ items: LibraryItem[] }>('/v1/library?limit=80')
      : fetch('/v1/public/library?limit=60', { headers: { Accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : { data: { items: [] } }))
          .then((json: { data?: { items?: LibraryItem[] } }) => ({ items: json.data?.items ?? [] }));

    Promise.resolve(load)
      .then((res) => {
        if (!cancelled) setItems(res?.items ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the library.');
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authed]);

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'पुस्तकालय' : 'Library'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {authed
          ? hi
            ? 'डिजिटल पुस्तकालय'
            : 'Digital library'
          : hi
            ? 'सार्वजनिक पुस्तकालय'
            : 'Public library'}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        {authed
          ? hi
            ? 'आपकी सदस्यता के अनुसार सभी संसाधन — पाठ, ऑडियो और वीडियो।'
            : 'All resources available to your membership — readings, audio and videos.'
          : hi
            ? 'सभी के लिए खुली सामग्री — पाठ, ऑडियो और वीडियो। और अधिक के लिए लॉगिन करें।'
            : 'Content open to everyone — readings, audio and videos. Sign in for more tiers.'}
      </p>

      {error ? (
        <Card className="mt-10 border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : loading ? (
        <div className="mt-10 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</div>
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.length === 0 ? (
            <Card className="p-6 text-muted-foreground">
              {hi ? 'अभी सामग्री नहीं है।' : 'No content yet.'}
            </Card>
          ) : (
            items.map((it) => <ResourceCard key={it.id} it={it} hi={hi} authed={authed} />)
          )}
        </div>
      )}
    </section>
  );
}
