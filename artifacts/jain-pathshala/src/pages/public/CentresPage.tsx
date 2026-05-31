import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';

interface CentreRow {
  id: string;
  name: string;
  locality: string | null;
  city_name: string;
  state_name: string;
  batch_count: number;
}

export default function CentresPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const [items, setItems] = useState<CentreRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/v1/public/centres', { headers: { Accept: 'application/json' } })
      .then((r) => r.ok ? r.json() : { data: { items: [] } })
      .then((json: { data?: { items?: CentreRow[] } }) => setItems(json.data?.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const byState = new Map<string, Map<string, CentreRow[]>>();
  for (const c of items) {
    if (!byState.has(c.state_name)) byState.set(c.state_name, new Map());
    const cities = byState.get(c.state_name)!;
    if (!cities.has(c.city_name)) cities.set(c.city_name, []);
    cities.get(c.city_name)!.push(c);
  }

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'केंद्र' : 'Centres'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'अपने पास की पाठशाला खोजें' : 'Find a Pathshala near you'}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        {hi
          ? 'मेघ संस्कार वाटिका नेटवर्क के सक्रिय केंद्र, राज्य और शहर के अनुसार।'
          : 'Active centres across the Megh Sanskar Vatika network, by state and city.'}
      </p>

      {loading ? (
        <div className="mt-10 text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <Card className="mt-10 p-6 text-muted-foreground">
          {hi ? 'अभी कोई केंद्र सूचीबद्ध नहीं है।' : 'No centres listed yet.'}
        </Card>
      ) : (
        <div className="mt-10 space-y-10">
          {Array.from(byState.entries()).map(([state, cities]) => (
            <div key={state}>
              <h2 className="font-display text-2xl text-secondary">{state}</h2>
              {Array.from(cities.entries()).map(([city, centres]) => (
                <div key={city} className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-sub">{city}</p>
                  <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {centres.map((c) => (
                      <Link key={c.id} href={`/centres/${c.id}`}>
                        <Card className="h-full p-5 transition-shadow hover:shadow-2 cursor-pointer">
                          <div className="font-display text-lg text-secondary">{c.name}</div>
                          {c.locality ? <div className="mt-1 text-sm text-muted-foreground">{c.locality}</div> : null}
                          <div className="mt-3 text-xs text-ink-sub">
                            {c.batch_count} {hi ? 'बैच' : c.batch_count === 1 ? 'batch' : 'batches'}
                          </div>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
