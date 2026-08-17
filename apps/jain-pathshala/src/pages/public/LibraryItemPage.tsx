import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import type { LibraryItemDto } from '@workspace/api-zod';
import { LibraryTextSheet } from '@/components/library/LibraryTextSheet';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { fetchLibraryItem } from '@/lib/library-cache';

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
    // Scoped fetch (GST-PRF-01): warm-tree hit when arriving from the index;
    // a cold deep-link downloads ONE item, not the whole corpus.
    fetchLibraryItem(authed, itemId)
      .then((found) => {
        if (cancelled) return;
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
