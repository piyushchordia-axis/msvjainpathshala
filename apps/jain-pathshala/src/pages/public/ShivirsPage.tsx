import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';

/** Mirrors the API projection exactly (snake_case, bilingual per CLAUDE.md). */
interface ShivirRow {
  id: string;
  name_en: string;
  name_hi: string | null;
  description_en: string | null;
  description_hi: string | null;
  start_date: string;
  end_date: string;
  location_text: string | null;
  city_name: string;
  capacity: number | null;
  msv_only: boolean;
}

function fmt(d: string): string {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ShivirsPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const [items, setItems] = useState<ShivirRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // A failed load used to render "No upcoming shivirs right now." (GST-ERR-01).
  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch('/v1/public/shivirs', { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(`shivirs ${r.status}`);
        return r.json();
      })
      .then((json: { data?: { items?: ShivirRow[] } }) => setItems(json.data?.items ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'शिविर' : 'Shivirs'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'आगामी शिविर' : 'Upcoming Shivirs'}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        {hi
          ? 'नेटवर्क भर में आगामी शिविर और रिट्रीट।'
          : 'Camps and retreats coming up across the network.'}
      </p>

      {loading ? (
        <GuestLoading hi={hi} />
      ) : error ? (
        <GuestError hi={hi} what="shivirs" whatHi="शिविर" onRetry={load} />
      ) : items.length === 0 ? (
        <Card className="mt-10 p-6 text-muted-foreground">
          {hi ? 'अभी कोई आगामी शिविर नहीं है।' : 'No upcoming shivirs right now.'}
        </Card>
      ) : (
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {items.map((s) => (
            <Link key={s.id} href={`/shivirs/${s.id}`}>
              <Card className="h-full cursor-pointer p-6 transition-shadow hover:shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  {/* Fall back to English when there is no Devanagari yet — a
                      blank card would be worse than an untranslated one. */}
                  <div className="font-display text-xl text-secondary">
                    {(hi ? s.name_hi : null) ?? s.name_en}
                  </div>
                  {s.msv_only ? (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {hi ? 'केवल एमएसवी' : 'MSV only'}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {fmt(s.start_date)} – {fmt(s.end_date)} · {s.city_name}
                </div>
                {s.location_text ? (
                  <div className="mt-1 text-xs text-ink-sub">{s.location_text}</div>
                ) : null}
                {((hi ? s.description_hi : null) ?? s.description_en) ? (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {(hi ? s.description_hi : null) ?? s.description_en}
                  </p>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
