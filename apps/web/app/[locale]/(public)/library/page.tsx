/** Public-tier library (SPEC §6.26, Q7) — @Public GET /v1/public/library. */

import { Card } from '@/components/ui/card';

interface LibraryItem {
  id: string;
  content_type: 'pdf' | 'video' | 'audio' | 'image';
  title_en: string;
  title_hi?: string | null;
  description_en?: string | null;
  description_hi?: string | null;
  embed_url?: string | null;
}

async function fetchLibrary(): Promise<LibraryItem[]> {
  const base = process.env.NEXT_INTERNAL_API_BASE_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/v1/public/library?limit=60`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { items?: LibraryItem[] } };
    return json.data?.items ?? [];
  } catch {
    return [];
  }
}

const TYPE_LABEL: Record<string, string> = {
  pdf: 'PDF',
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
};

export default async function LibraryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const hi = locale === 'hi';
  const items = await fetchLibrary();

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'पुस्तकालय' : 'Library'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'सार्वजनिक पुस्तकालय' : 'Public library'}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        {hi
          ? 'सभी के लिए खुली सामग्री — पाठ, ऑडियो और वीडियो। और अधिक के लिए लॉगिन करें।'
          : 'Content open to everyone — readings, audio and videos. Sign in for more tiers.'}
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.length === 0 ? (
          <Card className="p-6 text-muted-foreground">
            {hi ? 'अभी सार्वजनिक सामग्री नहीं है।' : 'No public content yet.'}
          </Card>
        ) : (
          items.map((it) => {
            const title = (hi ? it.title_hi : it.title_en) ?? it.title_en;
            const desc = (hi ? it.description_hi : it.description_en) ?? it.description_en ?? '';
            return (
              <Card key={it.id} className="flex flex-col p-5">
                <span className="w-fit rounded-pill bg-cream-dark px-2 py-0.5 text-xs font-semibold text-ink-sub">
                  {TYPE_LABEL[it.content_type] ?? it.content_type}
                </span>
                <h2 className="mt-3 font-display text-lg text-secondary">{title}</h2>
                {desc ? <p className="mt-1 flex-1 text-sm text-muted-foreground">{desc}</p> : null}
                {it.content_type === 'video' && it.embed_url ? (
                  <a
                    href={it.embed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex w-fit rounded-md bg-saffron px-3 py-2 text-sm font-semibold text-white hover:bg-saffron-700"
                  >
                    {hi ? 'देखें' : 'Watch'}
                  </a>
                ) : null}
              </Card>
            );
          })
        )}
      </div>
    </section>
  );
}
