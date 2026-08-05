import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { formatAgeGroup } from '@workspace/api-zod';

interface GalleryItem {
  id: string;
  first_name: string;
  age_group: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  niyam_type: string;
  image_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  caption_hi: string | null;
  is_featured: boolean;
  created_at: string;
}

export default function GalleryPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/v1/gallery?limit=60', { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error('http');
        return r.json();
      })
      .then((json: { data?: { items?: GalleryItem[] } }) => setItems(json.data?.items ?? []))
      .catch(() => setError(true))
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
          ? 'नियम पूरा करने वाले बच्चों की झलक — गोपनीयता के लिए केवल पहला नाम दिखाया जाता है, और केवल सहमति देने वाले परिवारों की तस्वीरें।'
          : 'A glimpse of children completing their niyams — for privacy we show only a first name and age group, and only photos from families who have opted in.'}
      </p>

      {loading ? (
        <div className="mt-10 text-muted-foreground">Loading…</div>
      ) : error ? (
        <Card className="mt-10 border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          {hi ? 'गैलरी लोड नहीं हो सकी।' : 'Could not load the gallery.'}
        </Card>
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.length === 0 ? (
            <Card className="p-6 text-muted-foreground">
              {hi ? 'अभी गैलरी में कुछ नहीं है।' : 'Nothing in the gallery yet.'}
            </Card>
          ) : (
            items.map((g) => {
              const niyam =
                (hi ? g.niyam_title_hi : g.niyam_title_en) || g.niyam_title_en;
              const caption = (hi ? g.caption_hi : g.caption) || g.caption || niyam;
              const src = g.thumbnail_url;
              const label = g.first_name || (hi ? 'गैलरी' : 'Gallery');
              return (
                <Card key={g.id} className="overflow-hidden p-0">
                  <div className="relative aspect-[4/3] bg-accent">
                    {src ? (
                      <img
                        src={src}
                        alt={caption ?? label}
                        width={400}
                        height={300}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span className="font-display text-2xl text-primary">
                          {(g.first_name ?? label).slice(0, 1).toUpperCase()}
                        </span>
                      </div>
                    )}
                    {g.is_featured ? (
                      <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground shadow">
                        {hi ? 'विशेष' : 'Featured'}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      {g.first_name ? (
                        <span className="font-display text-base text-secondary">
                          {g.first_name}
                        </span>
                      ) : (
                        <span />
                      )}
                      {g.age_group ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                          {formatAgeGroup(g.age_group, hi ? 'hi' : 'en')}
                        </span>
                      ) : null}
                    </div>
                    {caption ? (
                      <p className="mt-2 text-sm text-muted-foreground">{caption}</p>
                    ) : null}
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
