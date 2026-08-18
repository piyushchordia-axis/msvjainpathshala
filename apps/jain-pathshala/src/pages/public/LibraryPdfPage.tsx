import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import type { LibraryItemDto } from '@workspace/api-zod';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { fetchLibraryItem } from '@/lib/library-cache';
import { reportLibraryAccess } from '@/lib/library-access-log';

/**
 * §17.1.3 — web renders the PDF INLINE rather than downloading it.
 *
 * The browser's own PDF viewer already gives page navigation, zoom, search and
 * print, so an <iframe> is the whole feature: re-implementing a reader on top
 * of pdf.js would be a worse version of what every browser ships. The mobile
 * app is the one that needs a custom reader, because it reads a local file.
 *
 * The src is the freshly signed URL the item endpoint returned (1h TTL); it is
 * never persisted, so a bookmarked page re-fetches and re-signs on open.
 */
export default function LibraryPdfPage() {
  const { id } = useParams<{ id: string }>();
  const itemId = String(id ?? '');
  const locale = useLocale();
  const hi = locale === 'hi';
  const { user } = useAuth();
  const authed = !!user;
  const [item, setItem] = useState<LibraryItemDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLibraryItem(authed, itemId)
      .then((found) => {
        if (cancelled) return;
        setItem(found);
        if (found?.pdf_url) reportLibraryAccess({ itemId }, 'pdf_view');
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

  const title = item
    ? hi
      ? item.title_hi || item.title_en || item.title_gu || ''
      : item.title_en || item.title_hi || item.title_gu || ''
    : '';

  if (loading) {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      </section>
    );
  }

  if (!item?.pdf_url) {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">
          {hi
            ? 'यह पीडीएफ नहीं मिला — हो सकता है इसे हटा दिया गया हो। पुस्तकालय में वापस जाकर देखें।'
            : 'That PDF could not be found — it may have been removed. Go back to the library and look again.'}
        </p>
        <Link href="/library" className="mt-4 inline-block text-primary">
          ← {hi ? 'पुस्तकालय' : 'Library'}
        </Link>
      </section>
    );
  }

  return (
    <section className="container py-8">
      <Link
        href={`/library/${item.section_id}`}
        className="text-sm text-muted-foreground hover:text-primary"
      >
        ← {hi ? 'वापस' : 'Back'}
      </Link>
      <h1 className="mt-4 font-display text-2xl text-secondary">{title}</h1>
      {item.pdf_page_count ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {hi ? `${item.pdf_page_count} पृष्ठ` : `${item.pdf_page_count} pages`}
        </p>
      ) : null}
      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <iframe
          src={item.pdf_url}
          title={title || 'PDF'}
          className="h-[80vh] w-full"
          // No allow-scripts: this is a document, and the viewer chrome comes
          // from the browser rather than from anything inside the file.
          sandbox="allow-same-origin allow-popups allow-downloads"
        />
      </div>
    </section>
  );
}
