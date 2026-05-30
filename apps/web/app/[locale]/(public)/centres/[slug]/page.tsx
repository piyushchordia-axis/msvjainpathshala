/** Public centre detail (SPEC §6.26) — @Public GET /v1/public/centres/:id ([slug]=id). */

import { notFound } from 'next/navigation';

import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface CentreDetail {
  id: string;
  name: string;
  locality: string | null;
  pincode: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  city_name: string;
  state_name: string;
}
interface BatchRow {
  id: string;
  name: string;
  age_group: string;
  day_of_week: number[];
  start_time: string;
  end_time: string;
  capacity: number;
  language_preference: string | null;
}

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function fetchCentre(
  id: string,
): Promise<{ centre: CentreDetail | null; batches: BatchRow[] }> {
  const base = process.env.NEXT_INTERNAL_API_BASE_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/v1/public/centres/${id}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { centre: null, batches: [] };
    const json = (await res.json()) as {
      data?: { centre?: CentreDetail | null; batches?: BatchRow[] };
    };
    return { centre: json.data?.centre ?? null, batches: json.data?.batches ?? [] };
  } catch {
    return { centre: null, batches: [] };
  }
}

function hhmm(t: string): string {
  return t ? t.slice(0, 5) : '';
}
function days(arr: number[]): string {
  return (arr ?? []).map((d) => DAY[d] ?? d).join(', ');
}

export default async function CentreDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const hi = locale === 'hi';
  const { centre, batches } = await fetchCentre(slug);
  if (!centre) notFound();

  return (
    <section className="container py-12 md:py-16">
      <Link href="/centres" className="text-sm font-medium text-primary hover:underline">
        ← {hi ? 'सभी केंद्र' : 'All centres'}
      </Link>
      <h1 className="mt-4 font-display text-4xl text-secondary md:text-5xl">{centre.name}</h1>
      <p className="mt-2 text-muted-foreground">
        {[centre.locality, centre.city_name, centre.state_name].filter(Boolean).join(', ')}
        {centre.pincode ? ` — ${centre.pincode}` : ''}
      </p>
      {centre.contact_phone || centre.contact_email ? (
        <p className="mt-2 text-sm text-ink-sub">
          {[centre.contact_phone, centre.contact_email].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      <h2 className="mt-10 font-display text-2xl text-secondary">{hi ? 'बैच' : 'Batches'}</h2>
      {batches.length === 0 ? (
        <Card className="mt-4 p-6 text-muted-foreground">
          {hi
            ? 'इस केंद्र में अभी कोई सक्रिय बैच नहीं है।'
            : 'No active batches at this centre yet.'}
        </Card>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {batches.map((b) => (
            <Card key={b.id} className="p-5">
              <div className="flex items-center justify-between">
                <div className="font-display text-lg text-secondary">{b.name}</div>
                <span className="rounded-pill bg-cream-dark px-2 py-0.5 text-xs font-semibold capitalize text-ink-sub">
                  {b.age_group}
                </span>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {days(b.day_of_week)} · {hhmm(b.start_time)}–{hhmm(b.end_time)}
              </div>
              {b.language_preference ? (
                <div className="mt-1 text-xs text-ink-sub">{b.language_preference}</div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <div className="mt-10">
        <Link
          href="/enquire"
          className="inline-flex rounded-lg bg-saffron px-5 py-3 text-sm font-semibold text-white hover:bg-saffron-700"
        >
          {hi ? 'प्रवेश के लिए पूछताछ करें' : 'Enquire about admission'}
        </Link>
      </div>
    </section>
  );
}
