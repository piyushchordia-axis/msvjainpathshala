import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Building2, ChevronRight, MapPin, MessageCircle, Phone } from 'lucide-react';
import {
  type GranthBrowseMode,
  type GranthDirectoryDto,
  type GranthEntryDto,
  type GranthLibraryDto,
  cityOptions,
  entriesAtLibrary,
  entryAuthor,
  entryTitle,
  filterToLibraries,
  groupLibrariesByCity,
  librariesHoldingEntry,
  libraryAddress,
  libraryName,
  pickText,
} from '@workspace/api-zod';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast-jp';
import { mapsHref, telHref, whatsappHref } from '@/lib/granth-links';

export type GranthDirectoryProps = {
  directory: GranthDirectoryDto;
  hi: boolean;
  /** §17.11.4 — the viewer's own city, when the session knows one. */
  viewerCityId: string | null;
  /** Cross-link filter: only these libraries, when arriving from an item. */
  filterLibraryIds: string[] | null;
  onClearFilter: () => void;
  loading?: boolean;
};

/**
 * v3 §17.11.3–17.11.4 — the Offline Granth directory.
 *
 * Detail views are local state rather than routes: the directory lives inside a
 * tab of the section page, and pushing routes for it would put the reader's
 * back button somewhere they never navigated from.
 */
export function GranthDirectory({
  directory,
  hi,
  viewerCityId,
  filterLibraryIds,
  onClearFilter,
  loading,
}: GranthDirectoryProps) {
  const [mode, setMode] = useState<GranthBrowseMode>('library');
  const [query, setQuery] = useState('');
  const [openLibrary, setOpenLibrary] = useState<GranthLibraryDto | null>(null);
  const [openEntry, setOpenEntry] = useState<GranthEntryDto | null>(null);
  const [cityChoice, setCityChoice] = useState<string | null | undefined>(undefined);

  const visibleLibraries = useMemo(
    () => filterToLibraries(directory.libraries, filterLibraryIds),
    [directory.libraries, filterLibraryIds],
  );
  const cities = useMemo(() => cityOptions(visibleLibraries), [visibleLibraries]);
  const activeCity =
    cityChoice === undefined
      ? viewerCityId && visibleLibraries.some((l) => l.city_id === viewerCityId)
        ? viewerCityId
        : null
      : cityChoice;
  const groups = useMemo(
    () => groupLibrariesByCity(visibleLibraries, hi, activeCity),
    [visibleLibraries, hi, activeCity],
  );

  const q = query.trim().toLowerCase();
  const entries = useMemo(() => {
    const sorted = [...directory.entries].sort((a, b) =>
      entryTitle(a, hi).localeCompare(entryTitle(b, hi)),
    );
    if (!q) return sorted;
    return sorted.filter((e) =>
      [e.title_en, e.title_hi, e.author_en, e.author_hi, e.language].some((v) =>
        (v ?? '').toLowerCase().includes(q),
      ),
    );
  }, [directory.entries, hi, q]);

  if (loading && directory.libraries.length === 0 && directory.entries.length === 0) {
    return <p className="mt-8 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>;
  }

  if (openLibrary) {
    return (
      <LibraryDetail
        library={openLibrary}
        directory={directory}
        hi={hi}
        onBack={() => setOpenLibrary(null)}
        onOpenEntry={(entry) => {
          setOpenLibrary(null);
          setOpenEntry(entry);
        }}
      />
    );
  }

  if (openEntry) {
    return (
      <EntryDetail
        entry={openEntry}
        directory={directory}
        hi={hi}
        onBack={() => setOpenEntry(null)}
        onOpenLibrary={(library) => {
          setOpenEntry(null);
          setOpenLibrary(library);
        }}
      />
    );
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="flex gap-2" role="tablist">
        {(
          [
            { id: 'library' as const, label: hi ? 'पुस्तकालय अनुसार' : 'By library' },
            { id: 'granth' as const, label: hi ? 'ग्रंथ अनुसार' : 'By granth' },
          ]
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`rounded-full border px-4 py-2 text-sm transition ${
              mode === m.id
                ? 'border-primary bg-accent text-primary'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {filterLibraryIds && filterLibraryIds.length > 0 ? (
        <button
          type="button"
          onClick={onClearFilter}
          className="flex w-full items-center gap-2 rounded-lg border border-primary bg-card p-3 text-left text-sm text-primary"
        >
          <Building2 className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">
            {hi
              ? 'इस ग्रंथ को रखने वाले पुस्तकालय दिखाए जा रहे हैं'
              : 'Showing only libraries that hold this granth'}
          </span>
          <span className="text-xs underline">{hi ? 'हटाएँ' : 'Clear'}</span>
        </button>
      ) : null}

      {mode === 'library' ? (
        <>
          {/* §17.11.4 — cities derived from the published rows, so the filter
              can never offer a city with nothing behind it. */}
          {cities.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              <CityChip
                label={hi ? 'सभी शहर' : 'All cities'}
                active={activeCity === null}
                onClick={() => setCityChoice(null)}
              />
              {cities.map((city) => (
                <CityChip
                  key={city.id}
                  label={`${city.name} (${city.count})`}
                  active={activeCity === city.id}
                  onClick={() => setCityChoice(city.id)}
                />
              ))}
            </div>
          ) : null}

          {groups.length === 0 ? (
            <p className="text-muted-foreground">
              {hi
                ? 'अभी कोई ग्रंथ पुस्तकालय सूचीबद्ध नहीं है।'
                : 'No granth libraries are listed yet.'}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.cityId} className="space-y-2">
                <h3 className="font-display text-base text-muted-foreground">
                  {group.cityName}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.libraries.map((lib) => (
                    <button
                      key={lib.id}
                      type="button"
                      onClick={() => setOpenLibrary(lib)}
                      className="text-left"
                    >
                      <Card className="flex items-start gap-2 p-4 transition hover:border-primary/40">
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-base text-secondary">
                            {libraryName(lib, hi)}
                          </span>
                          <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                            {libraryAddress(lib, hi)}
                          </span>
                        </span>
                        <ChevronRight
                          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </Card>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={hi ? 'ग्रंथ खोजें…' : 'Search granths…'}
            aria-label={hi ? 'ग्रंथ खोज' : 'Granth search'}
            className="w-full rounded-lg border border-border bg-card px-4 py-2 text-sm"
          />
          {entries.length === 0 ? (
            <p className="text-muted-foreground">
              {query
                ? hi
                  ? 'कोई ग्रंथ नहीं मिला।'
                  : 'No matching granths.'
                : hi
                  ? 'अभी कोई ग्रंथ सूचीबद्ध नहीं है।'
                  : 'No granths are listed yet.'}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {entries.map((entry) => {
                const author = entryAuthor(entry, hi);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setOpenEntry(entry)}
                    className="text-left"
                  >
                    <Card className="flex items-start gap-2 p-4 transition hover:border-primary/40">
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-base text-secondary">
                          {entryTitle(entry, hi)}
                        </span>
                        {author || entry.language ? (
                          <span className="mt-1 block text-sm text-muted-foreground">
                            {[author, entry.language].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight
                        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CityChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? 'border-primary bg-accent text-primary'
          : 'border-border bg-card text-muted-foreground hover:border-primary/40'
      }`}
    >
      {label}
    </button>
  );
}

/** Hand-offs fail loudly with the fix named — never a silent dead button. */
function handoffFailed(hi: boolean, what: 'maps' | 'phone' | 'whatsapp') {
  const [title, body] = {
    maps: [
      hi ? 'नक्शा नहीं खुला' : 'Could not open maps',
      hi
        ? 'ब्राउज़र ने नक्शा नहीं खोला — पता कॉपी करके अपने नक्शा ऐप में खोजें।'
        : 'Your browser could not open a map — copy the address and search it in your maps app.',
    ],
    phone: [
      hi ? 'कॉल नहीं हो सकी' : 'Could not start the call',
      hi
        ? 'यह डिवाइस कॉल नहीं कर सकता — नंबर कॉपी करके किसी फ़ोन से मिलाएँ।'
        : 'This device cannot place calls — copy the number and dial it from a phone.',
    ],
    whatsapp: [
      hi ? 'WhatsApp नहीं खुला' : 'WhatsApp did not open',
      hi
        ? 'WhatsApp इंस्टॉल करें, या इसी नंबर पर कॉल करें।'
        : 'Install WhatsApp, or call the same number instead.',
    ],
  }[what];
  toast.error(title, body);
}

function openExternal(href: string | null, hi: boolean, what: 'maps' | 'phone' | 'whatsapp') {
  if (!href) {
    handoffFailed(hi, what);
    return;
  }
  const win = window.open(href, '_blank', 'noopener,noreferrer');
  // Popup blockers and missing protocol handlers both land here.
  if (!win) handoffFailed(hi, what);
}

function LibraryDetail({
  library,
  directory,
  hi,
  onBack,
  onOpenEntry,
}: {
  library: GranthLibraryDto;
  directory: GranthDirectoryDto;
  hi: boolean;
  onBack: () => void;
  onOpenEntry: (entry: GranthEntryDto) => void;
}) {
  const name = libraryName(library, hi);
  const address = libraryAddress(library, hi);
  const timings = pickText(hi, library.timings_en, library.timings_hi);
  const note = pickText(hi, library.note_en, library.note_hi);
  const catalogue = entriesAtLibrary(directory, library.id, hi);
  const whatsapp = library.has_whatsapp ? whatsappHref(library.contact_phone) : null;

  return (
    <div className="mt-8 space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {hi ? 'सभी पुस्तकालय' : 'All libraries'}
      </button>

      <div>
        <h2 className="font-display text-2xl text-secondary">{name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{library.city_name}</p>
      </div>

      <Card className="space-y-3 p-4">
        <button
          type="button"
          onClick={() =>
            openExternal(mapsHref({ ...library, name, address }), hi, 'maps')
          }
          className="flex w-full items-start gap-2 text-left text-sm text-primary hover:underline"
        >
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{address}</span>
        </button>
        {library.contact_name ? (
          <p className="text-sm text-foreground">{library.contact_name}</p>
        ) : null}
        {library.contact_phone ? (
          <button
            type="button"
            onClick={() => openExternal(telHref(library.contact_phone), hi, 'phone')}
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <Phone className="h-4 w-4 shrink-0" aria-hidden />
            {library.contact_phone}
          </button>
        ) : null}
        {whatsapp ? (
          <button
            type="button"
            onClick={() => openExternal(whatsapp, hi, 'whatsapp')}
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
            WhatsApp
          </button>
        ) : null}
        {timings ? <p className="text-sm text-muted-foreground">{timings}</p> : null}
      </Card>

      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

      <h3 className="font-display text-lg text-secondary">
        {hi ? 'यहाँ उपलब्ध ग्रंथ' : 'Granths held here'}
      </h3>
      {catalogue.length === 0 ? (
        <p className="text-muted-foreground">
          {hi
            ? 'इस पुस्तकालय की ग्रंथ सूची अभी दर्ज नहीं है।'
            : "This library's granth catalogue has not been listed yet."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {catalogue.map(({ entry, note: rowNote }) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onOpenEntry(entry)}
              className="text-left"
            >
              <Card className="p-4 transition hover:border-primary/40">
                <span className="block font-display text-base text-secondary">
                  {entryTitle(entry, hi)}
                </span>
                {/* The per-row note is what stops a wasted trip: "reference
                    only, not for issue" belongs against THIS shelf copy. */}
                {rowNote ? (
                  <span className="mt-1 block text-sm text-muted-foreground">{rowNote}</span>
                ) : null}
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryDetail({
  entry,
  directory,
  hi,
  onBack,
  onOpenLibrary,
}: {
  entry: GranthEntryDto;
  directory: GranthDirectoryDto;
  hi: boolean;
  onBack: () => void;
  onOpenLibrary: (library: GranthLibraryDto) => void;
}) {
  const title = entryTitle(entry, hi);
  const author = entryAuthor(entry, hi);
  const description = pickText(hi, entry.description_en, entry.description_hi);
  const holders = librariesHoldingEntry(directory, entry.id, hi);

  return (
    <div className="mt-8 space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {hi ? 'सभी ग्रंथ' : 'All granths'}
      </button>

      <div>
        <h2 className="font-display text-2xl text-secondary">{title}</h2>
        {author || entry.language ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {[author, entry.language].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </div>

      {description ? <p className="text-sm leading-6 text-foreground">{description}</p> : null}

      {entry.linked_item_id ? (
        <Button asChild variant="outline">
          <Link href={`/library/item/${entry.linked_item_id}`}>
            {hi ? 'ऑनलाइन पढ़ें' : 'Read online'}
          </Link>
        </Button>
      ) : null}

      <h3 className="font-display text-lg text-secondary">
        {hi ? 'यहाँ उपलब्ध है' : 'Available at'}
      </h3>
      {holders.length === 0 ? (
        <p className="text-muted-foreground">
          {hi
            ? 'किसी सूचीबद्ध पुस्तकालय में यह ग्रंथ दर्ज नहीं है।'
            : 'No listed library has recorded a copy of this granth.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {holders.map(({ library, note }) => (
            <button
              key={library.id}
              type="button"
              onClick={() => onOpenLibrary(library)}
              className="text-left"
            >
              <Card className="p-4 transition hover:border-primary/40">
                <span className="block font-display text-base text-secondary">
                  {libraryName(library, hi)}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {library.city_name}
                </span>
                {note ? (
                  <span className="mt-1 block text-sm text-muted-foreground">{note}</span>
                ) : null}
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
