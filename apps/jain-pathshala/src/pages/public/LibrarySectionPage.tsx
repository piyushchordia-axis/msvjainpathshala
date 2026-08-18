import { useEffect, useMemo, useRef, useState } from 'react';
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
import { toast } from '@/components/ui/toast-jp';

function pick(hi: boolean, en: string | null | undefined, hiVal: string | null | undefined, gu?: string | null) {
  if (hi) return hiVal || en || gu || '';
  return en || hiVal || gu || '';
}

function hasText(item: LibraryItemDto): boolean {
  return !!(item.text_content_en || item.text_content_hi || item.text_content_gu);
}

function openVideoExternally(youtubeUrl: string | null | undefined, hi: boolean) {
  const href = safeHref(youtubeUrl);
  if (!href) {
    toast.error(
      hi ? 'वीडियो नहीं खुला' : 'Could not open video',
      hi
        ? 'कोई ऐप यह लिंक नहीं खोल सका — YouTube या ब्राउज़र इंस्टॉल करें, फिर फिर से कोशिश करें।'
        : 'No app could open this link — install YouTube or a browser, then try again.',
    );
    return;
  }
  const win = window.open(href, '_blank', 'noopener,noreferrer');
  if (!win) {
    toast.error(
      hi ? 'वीडियो नहीं खुला' : 'Could not open video',
      hi
        ? 'कोई ऐप यह लिंक नहीं खोल सका — YouTube या ब्राउज़र इंस्टॉल करें, फिर फिर से कोशिश करें।'
        : 'No app could open this link — install YouTube or a browser, then try again.',
    );
  }
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
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => {
      playerRef.current?.pause();
      playerRef.current = null;
    };
  }, []);

  async function toggleAudio() {
    if (!audio) return;
    try {
      if (!playerRef.current || playerRef.current.src !== audio) {
        playerRef.current?.pause();
        const el = new Audio(audio);
        el.preload = 'metadata';
        el.addEventListener('ended', () => setPlaying(false));
        el.addEventListener('pause', () => setPlaying(false));
        el.addEventListener('play', () => setPlaying(true));
        playerRef.current = el;
      }
      if (playing) {
        playerRef.current.pause();
        setPlaying(false);
      } else {
        await playerRef.current.play();
        setPlaying(true);
      }
    } catch {
      toast.error(
        hi ? 'ऑडियो नहीं चला' : 'Could not play audio',
        hi
          ? 'लिंक समाप्त हो सकता है — पेज रिफ़्रेश करके फिर कोशिश करें।'
          : 'The link may have expired — refresh the page and try again.',
      );
      setPlaying(false);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="font-display text-base text-secondary">{title}</h3>
      <LibraryTarjLine item={item} hi={hi} />
      {availableAt && availableAt.library_count > 0 ? (
        <Link
          href={offlineGranthHref(item.section_id, availableAt.library_ids)}
          className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <Building2 className="h-3.5 w-3.5" aria-hidden />
          {hi
            ? `${availableAt.library_count} पुस्तकालय${availableAt.library_count === 1 ? '' : 'ों'} में उपलब्ध`
            : `Available at ${availableAt.library_count} ${availableAt.library_count === 1 ? 'library' : 'libraries'}`}
        </Link>
      ) : null}
      {audio || text || hasVideo || hasPdf || externalHref ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {audio ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 truncate"
              onClick={() => void toggleAudio()}
            >
              {playing ? (hi ? 'रोकें' : 'Pause') : hi ? 'ऑडियो' : 'Audio'}
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
          {hasVideo ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 truncate"
              onClick={() => openVideoExternally(item.youtube_url, hi)}
            >
              {hi ? 'वीडियो' : 'Video'}
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
    </Card>
  );
}

export default function LibrarySectionPage() {
  const { id } = useParams<{ id: string }>();
  const sectionId = String(id ?? '');
  const locale = useLocale();
  const hi = locale === 'hi';
  const { user } = useAuth();
  const authed = !!user;
  const [, navigate] = useLocation();
  const [section, setSection] = useState<LibrarySectionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    let cancelled = false;
    setLoading(true);
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
  }, [authed, sectionId]);

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

  if (loading) {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      </section>
    );
  }

  if (error || !section || (section.type !== 'item_list' && section.type !== 'granth')) {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">
          {error
            ? hi
              ? 'खंड लोड नहीं हो सका — अपना कनेक्शन जाँचें और पुनः प्रयास करें।'
              : "Couldn't load this section — check your connection and try again."
            : hi
              ? 'यह खंड उपलब्ध नहीं है।'
              : 'That section is not available.'}
        </p>
        <Link href="/library" className="mt-4 inline-block text-primary">
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
          {hi ? 'इस खंड के लिए साइन इन करें।' : 'Sign in to open this section.'}
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

  const subsections = section.subsections ?? [];
  const loose = section.items ?? [];
  // Only a granth section has a second tab to be on.
  const showOffline = isGranth && granthTab === 'offline';

  return (
    <section className="container py-12 md:py-16">
      <Link href="/library" className="text-sm text-muted-foreground hover:text-primary">
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
              className={`rounded-full border px-4 py-2 text-sm transition ${
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
            {hi ? 'इस खंड में अभी कोई सामग्री नहीं है।' : 'No items in this section yet.'}
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
