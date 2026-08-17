import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';

interface ShivirRow {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  location_text: string | null;
  city_name: string;
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
                <div className="font-display text-xl text-secondary">{s.name}</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {fmt(s.start_date)} – {fmt(s.end_date)} · {s.city_name}
                </div>
                {s.location_text ? (
                  <div className="mt-1 text-xs text-ink-sub">{s.location_text}</div>
                ) : null}
                {s.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
