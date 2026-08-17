import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocale } from '@/lib/locale-context';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';

interface CentreRow {
  id: string;
  name: string;
  locality: string | null;
  city_name: string;
  state_name: string;
  batch_count: number;
}

interface CentresMeta {
  has_more?: boolean;
  next_offset?: number | null;
}

const PAGE_SIZE = 200;

export default function CentresPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const [items, setItems] = useState<CentreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  // Debounced server-side search — the directory was capped at one page, so
  // centre 201 was unreachable with no signal (re-review finding 2).
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const fetchPage = useCallback(
    (offset: number, mode: 'replace' | 'append') => {
      const mySeq = ++seq.current;
      if (mode === 'replace') {
        setLoading(true);
        setError(false);
      } else {
        setLoadingMore(true);
      }
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (offset > 0) params.set('offset', String(offset));
      if (debouncedQuery) params.set('q', debouncedQuery);
      fetch(`/v1/public/centres?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      })
        .then((r) => {
          if (!r.ok) throw new Error(`centres ${r.status}`);
          return r.json();
        })
        .then((json: { data?: { items?: CentreRow[] }; meta?: CentresMeta }) => {
          if (seq.current !== mySeq) return;
          const page = json.data?.items ?? [];
          setItems((prev) => (mode === 'append' ? [...prev, ...page] : page));
          setHasMore(json.meta?.has_more === true);
          setNextOffset(
            typeof json.meta?.next_offset === 'number' ? json.meta.next_offset : null,
          );
        })
        .catch(() => {
          if (seq.current !== mySeq) return;
          // An API failure must not render "No centres listed yet."
          // (GST-ERR-01).
          if (mode === 'replace') setError(true);
        })
        .finally(() => {
          if (seq.current !== mySeq) return;
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [debouncedQuery],
  );

  useEffect(() => {
    fetchPage(0, 'replace');
  }, [fetchPage]);

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

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={hi ? 'नाम, इलाक़ा या शहर खोजें…' : 'Search by name, locality or city…'}
        className="mt-8 max-w-sm"
      />

      {loading ? (
        <GuestLoading hi={hi} />
      ) : error ? (
        <GuestError hi={hi} what="centres" whatHi="केंद्र" onRetry={() => fetchPage(0, 'replace')} />
      ) : items.length === 0 ? (
        <Card className="mt-10 p-6 text-muted-foreground">
          {debouncedQuery
            ? hi
              ? 'इस खोज से कोई केंद्र नहीं मिला — कुछ और आज़माएँ।'
              : 'No centres match that search — try something else.'
            : hi
              ? 'अभी कोई केंद्र सूचीबद्ध नहीं है।'
              : 'No centres listed yet.'}
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
          {hasMore && nextOffset != null ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={loadingMore}
                onClick={() => fetchPage(nextOffset, 'append')}
              >
                {loadingMore
                  ? hi
                    ? 'लोड हो रहा है…'
                    : 'Loading…'
                  : hi
                    ? 'और केंद्र देखें'
                    : 'Load more centres'}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
