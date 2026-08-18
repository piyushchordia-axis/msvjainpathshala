import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import type { LibraryItemDto } from '@workspace/api-zod';
import { LibraryTextSheet } from '@/components/library/LibraryTextSheet';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { fetchLibraryItem } from '@/lib/library-cache';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';

/**
 * Deep-link host: loads the item and auto-opens the bottom sheet reader.
 */
export default function LibraryItemPage() {
  const { id } = useParams<{ id: string }>();
  const itemId = String(id ?? '');
  const locale = useLocale();
  const hi = locale === 'hi';
  // U-19 — wait for the session cookie before choosing which audience's copy
  // to ask for, or a member deep-linking a members-only text is told it does
  // not exist and then silently re-fetched.
  const { user, loading: authLoading } = useAuth();
  const authed = !!user;
  const [, navigate] = useLocation();
  const [item, setItem] = useState<LibraryItemDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    // Scoped fetch (GST-PRF-01): warm-tree hit when arriving from the index;
    // a cold deep-link downloads ONE item, not the whole corpus.
    fetchLibraryItem(authed, itemId)
      .then((found) => {
        if (cancelled) return;
        setItem(found);
        setSheetOpen(!!found);
      })
      .catch(() => {
        // A dropped connection is not a missing text. Telling a reader their
        // stavan does not exist, when it does and the wifi went, sends them
        // looking for something else.
        if (!cancelled) {
          setItem(null);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authed, authLoading, itemId, reloadKey]);

  if (authLoading || loading) {
    return (
      <section className="container py-12">
        <GuestLoading hi={hi} />
      </section>
    );
  }

  if (error) {
    return (
      <section className="container py-12">
        <GuestError
          hi={hi}
          what="this text"
          whatHi="यह पाठ"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
        <Link href="/library" className="mt-4 inline-block text-sm leading-6 text-primary">
          ← {hi ? 'पुस्तकालय' : 'Library'}
        </Link>
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
      <Link href={backHref} className="text-sm leading-6 text-muted-foreground hover:text-primary">
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
