import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import type { LibraryItemDto, LibrarySectionDto } from '@workspace/api-zod';
import { t } from '@workspace/i18n';
import { Building2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LibraryTextSheet } from '@/components/library/LibraryTextSheet';
import { LibraryTarjLine } from '@/components/library/LibraryTarjLine';
import { reportLibraryAccess } from '@/lib/library-access-log';
import {
  type GranthAvailabilityMap,
  type GranthTab,
  fetchGranthAvailability,
  fetchGranthDirectory,
  isGranthTab,
  offlineGranthHref,
} from '@/lib/granth';
import { type GranthDirectoryDto, EMPTY_DIRECTORY, parseLibraryIds } from '@workspace/api-zod';
import { GranthDirectory } from '@/components/library/GranthDirectory';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { safeHref } from '@/lib/safe-url';
import { fetchLibrarySection } from '@/lib/library-cache';
import { Input } from '@/components/ui/input';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';
import { formatClock, useLibraryAudio } from '@/lib/library-audio-context';
import { videoEmbedSrc } from '@/lib/video-embed';

function pick(hi: boolean, en: string | null | undefined, hiVal: string | null | undefined, gu?: string | null) {
  if (hi) return hiVal || en || gu || '';
  return en || hiVal || gu || '';
}

function hasText(item: LibraryItemDto): boolean {
  return !!(item.text_content_en || item.text_content_hi || item.text_content_gu);
}

/**
 * Q7 — the video plays here. This used to be window.open, so a popup blocker
 * replaced a stavan recording with a toast telling a desktop reader to
 * "install YouTube". An unrecognised host still gets a plain link: better an
 * honest anchor than an iframe pointed somewhere we did not vet.
 */
function VideoEmbed({ url, title, hi }: { url: string; title: string; hi: boolean }) {
  const src = videoEmbedSrc(url);
  const href = safeHref(url);

  if (!src) {
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-sm leading-6 text-primary hover:underline"
      >
        {hi ? 'वीडियो देखें' : 'Watch the video'}
      </a>
    ) : null;
  }

  return (
    <div className="mt-3">
      <div
        className="relative w-full overflow-hidden rounded-md border border-border"
        style={{ paddingTop: '56.25%' }}
      >
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full"
        />
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs leading-6 text-muted-foreground hover:text-primary"
        >
          {hi ? 'नए टैब में खोलें' : 'Open in a new tab'}
        </a>
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  hi,
  onOpenText,
  availableAt,
}: {
  item: LibraryItemDto;
  hi: boolean;
  onOpenText: (item: LibraryItemDto) => void;
  /** §17.11.4 reverse cross-link — absent when nothing published holds it. */
  availableAt?: { library_count: number; library_ids: string[] };
}) {
  const title = pick(hi, item.title_en, item.title_hi, item.title_gu);
  const audio = item.audio_url ? safeHref(item.audio_url) : undefined;
  const hasVideo = !!item.youtube_url;
  const text = hasText(item);
  const hasPdf = !!item.pdf_url;
  const externalHref = item.external_url ? safeHref(item.external_url) : undefined;

  // One element for the whole page (see lib/library-audio-context). Identity is
  // the item id: comparing against el.src compared a relative signed path with
  // the absolute URL the DOM resolves it to, which is never equal, so every
  // press rebuilt the element — restarting playback and re-downloading the file.
  const { currentItemId, playing, position, duration, toggle, seek } = useLibraryAudio();
  const isCurrent = currentItemId === item.id;
  const isPlaying = isCurrent && playing;
  const shownDuration = isCurrent ? duration : (item.audio_duration_sec ?? 0);

  return (
    <Card className="p-4">
      <h3 className="font-display text-base text-secondary">{title}</h3>
      <LibraryTarjLine item={item} hi={hi} />
      {availableAt && availableAt.library_count > 0 ? (
        <Link
          href={offlineGranthHref(item.section_id, availableAt.library_ids)}
          className="mt-1 inline-flex items-center gap-1 text-sm leading-6 text-primary hover:underline"
        >
          <Building2 className="h-3.5 w-3.5" aria-hidden />
          {hi
            ? `${availableAt.library_count} पुस्तकालय${availableAt.library_count === 1 ? '' : 'ों'} में उपलब्ध`
            : `Available at ${availableAt.library_count} ${availableAt.library_count === 1 ? 'library' : 'libraries'}`}
        </Link>
      ) : null}
      {/* hasVideo is deliberately absent: the video renders as an embed below,
          not as a button here, so a video-only item must not draw an empty
          action row. */}
      {audio || text || hasPdf || externalHref ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {audio ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={isPlaying}
              className="min-w-0 flex-1 truncate"
              onClick={() =>
                toggle({ itemId: item.id, src: audio, title }, item.audio_duration_sec)
              }
            >
              {isPlaying ? (hi ? 'रोकें' : 'Pause') : hi ? 'ऑडियो' : 'Audio'}
            </Button>
          ) : null}
          {text ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 truncate"
              onClick={() => onOpenText(item)}
            >
              {hi ? 'पाठ' : 'Text'}
            </Button>
          ) : null}
          {/* Rendered only when the modality exists — never a disabled
              button, which reads as a broken page rather than as absent
              content (§17.1.3). */}
          {hasPdf ? (
            <Button asChild variant="outline" size="sm" className="min-w-0 flex-1 truncate">
              <Link href={`/library/pdf/${item.id}`}>{hi ? 'पीडीएफ' : 'PDF'}</Link>
            </Button>
          ) : null}
          {externalHref ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 truncate"
            >
              <a
                href={externalHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => reportLibraryAccess({ itemId: item.id }, 'external_link_open')}
              >
                {hi ? 'लिंक खोलें' : 'Open link'}
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}

      {audio && isCurrent ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="shrink-0 font-mono text-xs leading-6 tabular-nums text-muted-foreground">
            {formatClock(position)}
          </span>
          <input
            type="range"
            min={0}
            max={shownDuration || 0}
            step={1}
            value={Math.min(position, shownDuration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label={hi ? 'ऑडियो में आगे-पीछे जाएँ' : 'Seek audio'}
            disabled={!shownDuration}
            className="h-1 min-w-0 flex-1 accent-primary"
          />
          <span className="shrink-0 font-mono text-xs leading-6 tabular-nums text-muted-foreground">
            {formatClock(shownDuration)}
          </span>
        </div>
      ) : null}

      {hasVideo && item.youtube_url ? (
        <VideoEmbed url={item.youtube_url} title={title} hi={hi} />
      ) : null}
    </Card>
  );
}

export default function LibrarySectionPage() {
  const { id } = useParams<{ id: string }>();
  const sectionId = String(id ?? '');
  const locale = useLocale();
  const hi = locale === 'hi';
  // U-19 — the provider reads the session cookie in an effect, so `user` is
  // null on first paint. Deriving `authed` without waiting fetched the GUEST
  // tree, drew lock icons at a member, then fetched the whole tree again when
  // the effect landed. `authLoading` was always exposed; nothing read it.
  const { user, loading: authLoading } = useAuth();
  const authed = !!user;
  const [, navigate] = useLocation();
  const [section, setSection] = useState<LibrarySectionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [readerItem, setReaderItem] = useState<LibraryItemDto | null>(null);
  const [granthTab, setGranthTab] = useState<GranthTab>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    return isGranthTab(fromUrl) ? fromUrl : 'online';
  });
  const [availability, setAvailability] = useState<GranthAvailabilityMap>({});
  const [directory, setDirectory] = useState<GranthDirectoryDto | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState<string[] | null>(() =>
    parseLibraryIds(new URLSearchParams(window.location.search).get('libraryIds') ?? undefined),
  );

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    // Clearing the error is not housekeeping. Without it one failed load stuck
    // to the component: every later section rendered that first failure's copy,
    // however well it had loaded, until something unmounted the page.
    setError(null);
    // Scoped fetch (GST-PRF-01): a warm index visit serves this from the tree
    // cache; a cold deep-link downloads ONE section, not the whole corpus.
    fetchLibrarySection(authed, sectionId)
      .then((found) => {
        if (cancelled) return;
        setSection(found);
      })
      .catch(() => {
        if (!cancelled) setError('load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authed, authLoading, sectionId, reloadKey]);

  const title = useMemo(
    () => (section ? pick(hi, section.name_en, section.name_hi, section.name_gu) : ''),
    [section, hi],
  );

  // §17.11.2 — a granth section is an ordinary item_list plus a second tab.
  // Switches on type ONLY; the name is data an admin owns (v2 rule).
  const isGranth = section?.type === 'granth';

  useEffect(() => {
    if (!isGranth || !section) {
      setAvailability({});
      return;
    }
    // §17.9 — granth_view on section open.
    reportLibraryAccess({ sectionId: section.id }, 'granth_view');
    let cancelled = false;
    // §17.11.4 — the whole directory in one load, so both browse modes and
    // every detail view work from a single fetch.
    setDirectoryLoading(true);
    void fetchGranthDirectory(section.id)
      .then((d) => {
        if (!cancelled) setDirectory(d);
      })
      .catch(() => {
        /* keep whatever is already shown */
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });
    // §17.11.4 — one lookup per section open, never one per card.
    void fetchGranthAvailability(section.id).then((map) => {
      if (!cancelled) setAvailability(map);
    });
    return () => {
      cancelled = true;
    };
  }, [isGranth, section]);

  if (authLoading || loading) {
    return (
      <section className="container py-12">
        <GuestLoading hi={hi} />
      </section>
    );
  }

  // A transport failure is recoverable and gets a retry; a genuine 404 is not
  // and does not. Sharing one branch let the second wear the first's copy.
  if (error) {
    return (
      <section className="container py-12">
        <GuestError
          hi={hi}
          what="this section"
          whatHi="यह खंड"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
        <Link href="/library" className="mt-4 inline-block text-sm leading-6 text-primary">
          ← {hi ? 'पुस्तकालय' : 'Library'}
        </Link>
      </section>
    );
  }

  if (!section || (section.type !== 'item_list' && section.type !== 'granth')) {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">
          {hi ? 'यह खंड उपलब्ध नहीं है।' : 'That section is not available.'}
        </p>
        <Link href="/library" className="mt-4 inline-block text-sm leading-6 text-primary">
          ← {hi ? 'पुस्तकालय' : 'Library'}
        </Link>
      </section>
    );
  }

  if (section.requires_login && !authed) {
    return (
      <section className="container py-12">
        <h1 className="font-display text-3xl text-secondary">{title}</h1>
        <p className="mt-4 text-muted-foreground">
          {hi
            ? 'साइन इन करें — इस खंड के स्तवन, पाठ और ऑडियो सदस्यों के लिए हैं।'
            : 'Sign in to open — the stavans, texts and audio in this section are for members.'}
        </p>
        <Button
          className="mt-6"
          onClick={() => navigate(`/login?return=${encodeURIComponent(`/library/${section.id}`)}`)}
        >
          {hi ? 'साइन इन करें' : 'Sign in'}
        </Button>
      </section>
    );
  }

  // U-17 — a 60-item Istavan section was an unfiltered scroll. The section is
  // already fully loaded, so this is a filter over what is in hand, not a
  // search backend; mobile's in-section filter works the same way.
  const q = query.trim().toLowerCase();
  const hit = (...values: Array<string | null | undefined>) =>
    !q || values.some((v) => (v ?? '').toLowerCase().includes(q));

  const subsections = (section.subsections ?? [])
    .map((sub) => {
      const subHit = hit(sub.name_en, sub.name_hi, sub.name_gu);
      return {
        ...sub,
        items: (sub.items ?? []).filter(
          (i) => subHit || hit(i.title_en, i.title_hi, i.title_gu),
        ),
      };
    })
    .filter((sub) => (sub.items ?? []).length > 0);
  const loose = (section.items ?? []).filter((i) =>
    hit(i.title_en, i.title_hi, i.title_gu),
  );
  const total = (section.subsections ?? []).reduce(
    (sum, sub) => sum + (sub.items ?? []).length,
    (section.items ?? []).length,
  );
  // Only a granth section has a second tab to be on.
  const showOffline = isGranth && granthTab === 'offline';

  return (
    <section className="container py-12 md:py-16">
      <Link
        href="/library"
        className="text-sm leading-6 text-muted-foreground hover:text-primary"
      >
        ← {hi ? 'पुस्तकालय' : 'Library'}
      </Link>
      <h1 className="mt-4 font-display text-3xl text-secondary md:text-4xl">{title}</h1>

      {isGranth ? (
        <div className="mt-6 flex gap-2" role="tablist">
          {([
            { id: 'online' as const, label: hi ? 'ऑनलाइन ग्रंथ' : 'Online Granth' },
            { id: 'offline' as const, label: hi ? 'ऑफ़लाइन ग्रंथ' : 'Offline Granth' },
          ]).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={granthTab === tab.id}
              onClick={() => setGranthTab(tab.id)}
              className={`rounded-full border px-4 py-2 text-sm leading-6 transition ${
                granthTab === tab.id
                  ? 'border-primary bg-accent text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      {showOffline ? (
        <GranthDirectory
          directory={directory ?? EMPTY_DIRECTORY}
          hi={hi}
          viewerCityId={user?.city_id ?? null}
          filterLibraryIds={libraryFilter}
          onClearFilter={() => setLibraryFilter(null)}
          loading={directoryLoading}
        />
      ) : null}

      {showOffline || total < 8 ? null : (
        <div className="mt-6 max-w-sm">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={hi ? 'इस खंड में खोजें…' : 'Search this section…'}
            aria-label={hi ? 'इस खंड में खोजें' : 'Search this section'}
          />
        </div>
      )}

      <div className={`mt-8 space-y-8 ${showOffline ? 'hidden' : ''}`}>
        {subsections.map((sub) => (
          <div key={sub.id}>
            <h2 className="font-display text-xl text-secondary">
              {pick(hi, sub.name_en, sub.name_hi, sub.name_gu)}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(sub.items ?? []).map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  hi={hi}
                  onOpenText={setReaderItem}
                  availableAt={availability[item.id]}
                />
              ))}
            </div>
          </div>
        ))}

        {loose.length > 0 ? (
          <div>
            {subsections.length > 0 ? (
              <h2 className="font-display text-xl text-secondary">{hi ? 'अन्य' : 'Other'}</h2>
            ) : null}
            <div className={`grid gap-3 sm:grid-cols-2 ${subsections.length > 0 ? 'mt-3' : ''}`}>
              {loose.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  hi={hi}
                  onOpenText={setReaderItem}
                  availableAt={availability[item.id]}
                />
              ))}
            </div>
          </div>
        ) : null}

        {subsections.length === 0 && loose.length === 0 ? (
          <p className="text-muted-foreground">
            {q
              ? hi
                ? 'कोई परिणाम नहीं — कोई और शब्द आज़माएँ।'
                : 'Nothing matched — try another word.'
              : hi
                ? 'इस खंड में अभी कोई सामग्री नहीं है।'
                : 'No items in this section yet.'}
          </p>
        ) : null}

        {/*
          §17.10.1 — the same action as library home, prefilled with this
          section. Someone who has just read through a section without finding
          what they came for is exactly who it is for.
        */}
        <div className="mt-10 border-t border-border pt-6">
          <Button asChild variant="outline">
            <Link href={`/library/request?section=${encodeURIComponent(sectionId)}`}>
              {t('libraryRequests.action', locale)}
            </Link>
          </Button>
        </div>
      </div>

      <LibraryTextSheet
        item={readerItem}
        open={!!readerItem}
        onOpenChange={(open) => {
          if (!open) setReaderItem(null);
        }}
      />
    </section>
  );
}
