import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { formatAgeGroups } from '@workspace/api-zod';
import {
  TeamMemberCard,
  type TeamCardModel,
} from '@/components/public/TeamMemberCard';

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

type CentreTeamCategory = {
  id: string;
  key: string;
  name_en: string;
  name_hi: string;
  member_count: number;
  members: TeamCardModel[];
};

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
  const [teamCategories, setTeamCategories] = useState<CentreTeamCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!centreId) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    Promise.all([
      fetch(`/v1/public/centres/${centreId}`, { headers: { Accept: 'application/json' } }),
      fetch(`/v1/team/centres/${centreId}`, { headers: { Accept: 'application/json' } }),
    ])
      .then(async ([centreRes, teamRes]) => {
        if (centreRes.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!centreRes.ok) throw new Error('centre fetch failed');

        const centreJson = (await centreRes.json()) as {
          data?: { centre?: CentreDetail | null; batches?: BatchRow[] };
        };
        if (!centreJson.data?.centre) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (cancelled) return;

        setCentre(centreJson.data.centre);
        setBatches(centreJson.data.batches ?? []);

        // Team is optional — 404 / failure omits the block, does not fail the page.
        if (!teamRes.ok) {
          setTeamCategories([]);
          return;
        }
        const teamJson = (await teamRes.json()) as {
          data?: { categories?: CentreTeamCategory[] };
        };
        // Only keep categories that actually have cards — omit empty headings.
        setTeamCategories(
          (teamJson.data?.categories ?? []).filter((c) => (c.members?.length ?? 0) > 0),
        );
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
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

      {teamCategories.length > 0 ? (
        <div className="mt-12 space-y-10">
          <h2
            className="font-display text-2xl text-secondary"
            style={{ lineHeight: '1.3' }}
          >
            {hi ? 'टीम' : 'Team'}
          </h2>
          {teamCategories.map((cat) => (
            <section key={cat.id} aria-labelledby={`centre-team-${cat.id}`}>
              <h3
                id={`centre-team-${cat.id}`}
                className="break-words font-display text-xl text-secondary"
                style={{ lineHeight: '22px' }}
              >
                {hi ? cat.name_hi : cat.name_en}
              </h3>
              <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {cat.members.map((m) => (
                  <TeamMemberCard key={m.id} member={m} locale={locale} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

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
