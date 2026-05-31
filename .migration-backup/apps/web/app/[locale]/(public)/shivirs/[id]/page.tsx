/** Public shivir detail (SPEC §6.26) — @Public GET /v1/public/shivirs/:id. */

import { notFound } from 'next/navigation';

import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface ShivirDetail {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  location_text: string | null;
  city_name: string;
  capacity: number | null;
  msv_only: boolean;
}
interface SessionRow {
  id: string;
  day_number: number;
  session_date: string;
  start_time: string;
  end_time: string;
}

async function fetchShivir(
  id: string,
): Promise<{ event: ShivirDetail | null; sessions: SessionRow[] }> {
  const base = process.env.NEXT_INTERNAL_API_BASE_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/v1/public/shivirs/${id}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { event: null, sessions: [] };
    const json = (await res.json()) as {
      data?: { event?: ShivirDetail | null; sessions?: SessionRow[] };
    };
    return { event: json.data?.event ?? null, sessions: json.data?.sessions ?? [] };
  } catch {
    return { event: null, sessions: [] };
  }
}

function fmtDate(d: string): string {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function hhmm(t: string): string {
  return t ? t.slice(0, 5) : '';
}

export default async function ShivirDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const hi = locale === 'hi';
  const { event, sessions } = await fetchShivir(id);
  if (!event) notFound();

  return (
    <section className="container py-12 md:py-16">
      <Link href="/shivirs" className="text-sm font-medium text-primary hover:underline">
        ← {hi ? 'सभी शिविर' : 'All shivirs'}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-4xl text-secondary md:text-5xl">{event.name}</h1>
        {event.msv_only ? (
          <span className="rounded-pill bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
            MSV
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-muted-foreground">
        {fmtDate(event.start_date)} – {fmtDate(event.end_date)} · {event.city_name}
      </p>
      {event.location_text ? (
        <p className="mt-1 text-sm text-ink-sub">{event.location_text}</p>
      ) : null}
      {event.description ? (
        <p className="mt-5 max-w-2xl whitespace-pre-line text-muted-foreground">
          {event.description}
        </p>
      ) : null}

      <h2 className="mt-10 font-display text-2xl text-secondary">{hi ? 'सत्र' : 'Schedule'}</h2>
      {sessions.length === 0 ? (
        <Card className="mt-4 p-6 text-muted-foreground">
          {hi ? 'सत्र शीघ्र घोषित किए जाएंगे।' : 'Sessions will be announced soon.'}
        </Card>
      ) : (
        <div className="mt-4 space-y-2">
          {sessions.map((s) => (
            <Card key={s.id} className="flex items-center justify-between p-4">
              <span className="font-medium text-secondary">
                {hi ? 'दिन' : 'Day'} {s.day_number} · {fmtDate(s.session_date)}
              </span>
              <span className="text-sm text-muted-foreground">
                {hhmm(s.start_time)}–{hhmm(s.end_time)}
              </span>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-10">
        <Link
          href="/enquire"
          className="inline-flex rounded-lg bg-saffron px-5 py-3 text-sm font-semibold text-white hover:bg-saffron-700"
        >
          {hi ? 'पूछताछ करें' : 'Enquire'}
        </Link>
      </div>
    </section>
  );
}
