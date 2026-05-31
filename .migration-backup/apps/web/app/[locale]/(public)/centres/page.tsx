/**
 * Public centre directory (SPEC §6.26). Reads @Public `GET /v1/public/centres`
 * and groups active centres by state → city.
 */

import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface CentreRow {
  id: string;
  name: string;
  locality: string | null;
  pincode: string | null;
  contact_phone: string | null;
  city_id: string;
  city_name: string;
  state_name: string;
  batch_count: number;
}

async function fetchCentres(): Promise<CentreRow[]> {
  const base = process.env.NEXT_INTERNAL_API_BASE_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/v1/public/centres`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { items?: CentreRow[] } };
    return json.data?.items ?? [];
  } catch {
    return [];
  }
}

export default async function CentresPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const hi = locale === 'hi';
  const items = await fetchCentres();

  // Group state → city → centres.
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

      {items.length === 0 ? (
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
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-sub">
                    {city}
                  </p>
                  <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {centres.map((c) => (
                      <Link key={c.id} href={`/centres/${c.id}`}>
                        <Card className="h-full p-5 transition-shadow hover:shadow-2">
                          <div className="font-display text-lg text-secondary">{c.name}</div>
                          {c.locality ? (
                            <div className="mt-1 text-sm text-muted-foreground">{c.locality}</div>
                          ) : null}
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
