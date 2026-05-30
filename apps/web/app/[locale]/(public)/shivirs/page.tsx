/** Public shivir listing (SPEC §6.26) — @Public GET /v1/public/shivirs. */

import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface ShivirRow {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  location_text: string | null;
  city_name: string;
}

async function fetchShivirs(): Promise<ShivirRow[]> {
  const base = process.env.NEXT_INTERNAL_API_BASE_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/v1/public/shivirs`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { items?: ShivirRow[] } };
    return json.data?.items ?? [];
  } catch {
    return [];
  }
}

function fmt(d: string): string {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function ShivirsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const hi = locale === 'hi';
  const items = await fetchShivirs();

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">Shivirs</p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'आगामी शिविर' : 'Upcoming Shivirs'}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        {hi
          ? 'नेटवर्क भर में आगामी शिविर और रिट्रीट।'
          : 'Camps and retreats coming up across the network.'}
      </p>
      {items.length === 0 ? (
        <Card className="mt-10 p-6 text-muted-foreground">
          {hi ? 'अभी कोई आगामी शिविर नहीं है।' : 'No upcoming shivirs right now.'}
        </Card>
      ) : (
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {items.map((s) => (
            <Link key={s.id} href={`/shivirs/${s.id}`}>
              <Card className="h-full p-6 transition-shadow hover:shadow-2">
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
