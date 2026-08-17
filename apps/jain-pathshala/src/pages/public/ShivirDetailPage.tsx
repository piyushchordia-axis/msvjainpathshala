import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/locale-context';
import { GuestError } from '@/components/public/GuestLoadState';

interface ShivirDetail {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  location_text: string | null;
  city_name: string;
  state_name: string;
  capacity: number | null;
  contact_info: string | null;
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
      <h1 className="mt-4 font-display text-4xl text-secondary md:text-5xl">{shivir.name}</h1>
      <p className="mt-2 text-muted-foreground">
        {fmt(shivir.start_date)} – {fmt(shivir.end_date)} · {shivir.city_name}, {shivir.state_name}
      </p>
      {shivir.location_text ? (
        <p className="mt-1 text-sm text-muted-foreground">{shivir.location_text}</p>
      ) : null}
      {shivir.capacity ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {hi ? `क्षमता: ${shivir.capacity}` : `Capacity: ${shivir.capacity}`}
        </p>
      ) : null}

      {shivir.description ? (
        <div className="mt-8 max-w-2xl">
          <h2 className="font-display text-xl text-secondary">
            {hi ? 'विवरण' : 'About this shivir'}
          </h2>
          <p className="mt-2 text-muted-foreground">{shivir.description}</p>
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
