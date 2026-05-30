/** Public gallery (SPEC §6.26) — @Public GET /v1/gallery (non-identifying fields only). */

import { Card } from '@/components/ui/card';

interface GalleryItem {
  id: string;
  first_name: string;
  age_group: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  niyam_type: string;
  is_featured: boolean;
  created_at: string;
}

async function fetchGallery(): Promise<GalleryItem[]> {
  const base = process.env.NEXT_INTERNAL_API_BASE_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/v1/gallery?limit=60`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { items?: GalleryItem[] } };
    return json.data?.items ?? [];
  } catch {
    return [];
  }
}

const AGE_LABEL: Record<string, string> = {
  bal: 'Bal',
  kishor: 'Kishor',
  tarun: 'Tarun',
  yuva: 'Yuva',
};

export default async function GalleryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const hi = locale === 'hi';
  const items = await fetchGallery();

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'गैलरी' : 'Gallery'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'हमारे बच्चों का पुण्य' : 'Punya from our children'}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        {hi
          ? 'नियम पूरा करने वाले बच्चों की झलक — गोपनीयता के लिए केवल पहला नाम दिखाया जाता है।'
          : 'A glimpse of children completing their niyams — for privacy we show only a first name and age group.'}
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.length === 0 ? (
          <Card className="p-6 text-muted-foreground">
            {hi ? 'अभी गैलरी में कुछ नहीं है।' : 'Nothing in the gallery yet.'}
          </Card>
        ) : (
          items.map((g) => {
            const niyam = (hi ? g.niyam_title_hi : g.niyam_title_en) ?? g.niyam_title_en;
            return (
              <Card key={g.id} className="overflow-hidden p-0">
                <div className="flex aspect-[4/3] items-center justify-center bg-cream-dark">
                  <span className="font-display text-2xl text-saffron-700">{g.first_name}</span>
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-pill bg-cream-dark px-2 py-0.5 text-xs font-semibold text-ink-sub">
                      {AGE_LABEL[g.age_group] ?? g.age_group}
                    </span>
                    {g.is_featured ? (
                      <span className="rounded-pill bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                        {hi ? 'विशेष' : 'Featured'}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{niyam}</p>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </section>
  );
}
