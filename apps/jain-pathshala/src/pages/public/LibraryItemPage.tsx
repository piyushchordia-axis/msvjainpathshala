import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import type { LibraryItemDto, LibrarySectionDto } from '@workspace/api-zod';
import { LibraryTextSheet } from '@/components/library/LibraryTextSheet';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { apiGet } from '@/lib/api-client';

function findItem(sections: LibrarySectionDto[], itemId: string): LibraryItemDto | null {
  for (const section of sections) {
    for (const sub of section.subsections ?? []) {
      const hit = (sub.items ?? []).find((i) => i.id === itemId);
      if (hit) return hit;
    }
    const loose = (section.items ?? []).find((i) => i.id === itemId);
    if (loose) return loose;
  }
  return null;
}

/**
 * Deep-link host: loads the item and auto-opens the bottom sheet reader.
 */
export default function LibraryItemPage() {
  const { id } = useParams<{ id: string }>();
  const itemId = String(id ?? '');
  const locale = useLocale();
  const hi = locale === 'hi';
  const { user } = useAuth();
  const authed = !!user;
  const [, navigate] = useLocation();
  const [item, setItem] = useState<LibraryItemDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = authed
      ? apiGet<{ sections: LibrarySectionDto[] }>('/v1/library')
      : fetch('/v1/public/library', { headers: { Accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : { data: { sections: [] } }))
          .then((json: { data?: { sections?: LibrarySectionDto[] } }) => ({
            sections: json.data?.sections ?? [],
          }));

    Promise.resolve(load)
      .then((res) => {
        if (cancelled) return;
        const found = findItem(res.sections ?? [], itemId);
        setItem(found);
        setSheetOpen(!!found);
      })
      .catch(() => {
        if (!cancelled) setItem(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authed, itemId]);

  if (loading) {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      </section>
    );
  }

  if (!item) {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">{hi ? 'पाठ नहीं मिला।' : 'That text could not be found.'}</p>
        <Link href="/library" className="mt-4 inline-block text-primary">
          ← {hi ? 'पुस्तकालय' : 'Library'}
        </Link>
      </section>
    );
  }

  const backHref = `/library/${item.section_id}`;

  return (
    <section className="container py-12">
      <Link href={backHref} className="text-sm text-muted-foreground hover:text-primary">
        ← {hi ? 'वापस' : 'Back'}
      </Link>
      <p className="mt-6 text-muted-foreground">
        {hi ? 'पाठ नीचे खुल रहा है…' : 'Opening text…'}
      </p>
      <LibraryTextSheet
        item={item}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) navigate(backHref);
        }}
      />
    </section>
  );
}
