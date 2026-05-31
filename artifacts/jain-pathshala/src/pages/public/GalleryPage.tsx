import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';

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

const AGE_LABEL: Record<string, string> = {
  bal: 'Bal',
  kishor: 'Kishor',
  tarun: 'Tarun',
  yuva: 'Yuva',
};

export default function GalleryPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/v1/gallery?limit=60', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { data: { items: [] } }))
      .then((json: { data?: { items?: GalleryItem[] } }) => setItems(json.data?.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

      {loading ? (
        <div className="mt-10 text-muted-foreground">Loading…</div>
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.length === 0 ? (
            <Card className="p-6 text-muted-foreground">
              {hi ? 'अभी गैलरी में कुछ नहीं है।' : 'Nothing in the gallery yet.'}
            </Card>
          ) : (
            items.map((g) => {
              const niyam =
                (hi ? g.niyam_title_hi : g.niyam_title_en) ?? g.niyam_title_en;
              return (
                <Card key={g.id} className="overflow-hidden p-0">
                  <div className="flex aspect-[4/3] items-center justify-center bg-accent">
                    <span className="font-display text-2xl text-primary">{g.first_name}</span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        {AGE_LABEL[g.age_group] ?? g.age_group}
                      </span>
                      {g.is_featured ? (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
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
      )}
    </section>
  );
}
