import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { formatAgeGroups } from '@workspace/api-zod';

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
  age_groups: string[];
  day_of_week: number[];
  start_time: string;
  end_time: string;
  capacity: number;
  language_preference: string | null;
}

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function hhmm(t: string): string {
  return t ? t.slice(0, 5) : '';
}

function days(arr: number[]): string {
  return (arr ?? []).map((d) => DAY[d] ?? String(d)).join(', ');
}

export default function CentreDetailPage() {
  const params = useParams<{ id: string }>();
  const centreId = params.id;
  const locale = useLocale();
  const hi = locale === 'hi';

  const [centre, setCentre] = useState<CentreDetail | null>(null);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!centreId) { setLoading(false); setNotFound(true); return; }
    fetch(`/v1/public/centres/${centreId}`, { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((json: { data?: { centre?: CentreDetail | null; batches?: BatchRow[] } } | null) => {
        if (!json) return;
        setCentre(json.data?.centre ?? null);
        setBatches(json.data?.batches ?? []);
        if (!json.data?.centre) setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [centreId]);

  if (loading) {
    return (
      <section className="container py-12">
        <div className="text-muted-foreground">Loading…</div>
      </section>
    );
  }

  if (notFound || !centre) {
    return (
      <section className="container py-12">
        <Link href="/centres" className="text-sm font-medium text-primary hover:underline">
          ← {hi ? 'सभी केंद्र' : 'All centres'}
        </Link>
        <Card className="mt-6 p-6 text-muted-foreground">
          {hi ? 'यह केंद्र नहीं मिला।' : 'Centre not found.'}
        </Card>
      </section>
    );
  }

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
        <p className="mt-2 text-sm text-muted-foreground">
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
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {formatAgeGroups(b.age_groups, hi ? 'hi' : 'en')}
                </span>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {days(b.day_of_week)} · {hhmm(b.start_time)}–{hhmm(b.end_time)}
              </div>
              {b.language_preference ? (
                <div className="mt-1 text-xs text-muted-foreground">{b.language_preference}</div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <div className="mt-10">
        <Link
          href="/enquire"
          className="inline-flex rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {hi ? 'प्रवेश के लिए पूछताछ करें' : 'Enquire about admission'}
        </Link>
      </div>
    </section>
  );
}
