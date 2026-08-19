import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/locale-context';
import { GuestError } from '@/components/public/GuestLoadState';

interface ShivirDetail {
  id: string;
  name_en: string;
  name_hi: string | null;
  description_en: string | null;
  description_hi: string | null;
  start_date: string;
  end_date: string;
  location_text: string | null;
  city_name: string;
  state_name: string;
  capacity: number | null;
  msv_only: boolean;
  contact_info: string | null;
  registered_count: number;
}

function fmt(d: string): string {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ShivirDetailPage() {
  const params = useParams<{ id: string }>();
  const shivirId = params.id;
  const locale = useLocale();
  const hi = locale === 'hi';

  const [shivir, setShivir] = useState<ShivirDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!shivirId) { setLoading(false); setNotFound(true); return; }
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    fetch(`/v1/public/shivirs/${shivirId}`, { headers: { Accept: 'application/json' } })
      .then((r) => {
        // 404 means "this shivir doesn't exist"; anything else failing means "we
        // couldn't ask" — conflating the two told guests real shivirs were gone
        // (GST-ERR-02).
        if (r.status === 404) { setNotFound(true); return null; }
        if (!r.ok) { setLoadError(true); return null; }
        return r.json();
      })
      .then((json: { data?: ShivirDetail | null } | null) => {
        if (!json) return;
        setShivir(json.data ?? null);
        if (!json.data) setNotFound(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [shivirId, reloadKey]);

  if (loading) {
    return (
      <section className="container py-12">
        <div className="text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="container py-12">
        <GuestError
          hi={hi}
          what="this shivir"
          whatHi="यह शिविर"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </section>
    );
  }

  if (notFound || !shivir) {
    return (
      <section className="container py-12">
        <Link href="/shivirs" className="text-sm font-medium text-primary hover:underline">
          ← {hi ? 'सभी शिविर' : 'All shivirs'}
        </Link>
        <Card className="mt-6 p-6 text-muted-foreground">
          {hi ? 'यह शिविर नहीं मिला।' : 'Shivir not found.'}
        </Card>
      </section>
    );
  }

  return (
    <section className="container py-12 md:py-16">
      <Link href="/shivirs" className="text-sm font-medium text-primary hover:underline">
        ← {hi ? 'सभी शिविर' : 'All shivirs'}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-4xl text-secondary md:text-5xl">
          {(hi ? shivir.name_hi : null) ?? shivir.name_en}
        </h1>
        {shivir.msv_only ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
            {hi ? 'केवल एमएसवी' : 'MSV only'}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-muted-foreground">
        {fmt(shivir.start_date)} – {fmt(shivir.end_date)} · {shivir.city_name}, {shivir.state_name}
      </p>
      {shivir.location_text ? (
        <p className="mt-1 text-sm text-muted-foreground">{shivir.location_text}</p>
      ) : null}
      {shivir.capacity ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {/* Places LEFT, not raw capacity: a family deciding whether to
              register needs the number that changes their answer. */}
          {hi
            ? `स्थान: ${Math.max(0, shivir.capacity - shivir.registered_count)} / ${shivir.capacity}`
            : `Places left: ${Math.max(0, shivir.capacity - shivir.registered_count)} of ${shivir.capacity}`}
        </p>
      ) : null}

      {((hi ? shivir.description_hi : null) ?? shivir.description_en) ? (
        <div className="mt-8 max-w-2xl">
          <h2 className="font-display text-xl text-secondary">
            {hi ? 'विवरण' : 'About this shivir'}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {(hi ? shivir.description_hi : null) ?? shivir.description_en}
          </p>
        </div>
      ) : null}

      {shivir.contact_info ? (
        <div className="mt-6">
          <h2 className="font-display text-xl text-secondary">{hi ? 'संपर्क' : 'Contact'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{shivir.contact_info}</p>
        </div>
      ) : null}

      <div className="mt-10">
        <Button asChild>
          <Link href="/enquire">
            {hi ? 'इस शिविर के बारे में पूछें' : 'Enquire about this shivir'}
          </Link>
        </Button>
      </div>
    </section>
  );
}
