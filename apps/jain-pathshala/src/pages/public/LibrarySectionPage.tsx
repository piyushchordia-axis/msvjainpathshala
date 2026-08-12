import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import type { LibraryItemDto, LibrarySectionDto } from '@workspace/api-zod';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LibraryTextSheet } from '@/components/library/LibraryTextSheet';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { apiGet } from '@/lib/api-client';
import { safeHref } from '@/lib/safe-url';
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
}: {
  item: LibraryItemDto;
  hi: boolean;
  onOpenText: (item: LibraryItemDto) => void;
}) {
  const title = pick(hi, item.title_en, item.title_hi, item.title_gu);
  const audio = item.audio_url ? safeHref(item.audio_url) : undefined;
  const hasVideo = !!item.youtube_url;
  const text = hasText(item);
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
      {audio || text || hasVideo ? (
        <div className="mt-3 flex flex-nowrap gap-2">
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
        const found = (res.sections ?? []).find((s) => s.id === sectionId) ?? null;
        setSection(found);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load section.');
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

  if (loading) {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      </section>
    );
  }

  if (error || !section || section.type !== 'item_list') {
    return (
      <section className="container py-12">
        <p className="text-muted-foreground">
          {error ?? (hi ? 'यह खंड उपलब्ध नहीं है।' : 'That section is not available.')}
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

  return (
    <section className="container py-12 md:py-16">
      <Link href="/library" className="text-sm text-muted-foreground hover:text-primary">
        ← {hi ? 'पुस्तकालय' : 'Library'}
      </Link>
      <h1 className="mt-4 font-display text-3xl text-secondary md:text-4xl">{title}</h1>

      <div className="mt-8 space-y-8">
        {subsections.map((sub) => (
          <div key={sub.id}>
            <h2 className="font-display text-xl text-secondary">
              {pick(hi, sub.name_en, sub.name_hi, sub.name_gu)}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(sub.items ?? []).map((item) => (
                <ItemRow key={item.id} item={item} hi={hi} onOpenText={setReaderItem} />
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
                <ItemRow key={item.id} item={item} hi={hi} onOpenText={setReaderItem} />
              ))}
            </div>
          </div>
        ) : null}

        {subsections.length === 0 && loose.length === 0 ? (
          <p className="text-muted-foreground">
            {hi ? 'इस खंड में अभी कोई सामग्री नहीं है।' : 'No items in this section yet.'}
          </p>
        ) : null}
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
