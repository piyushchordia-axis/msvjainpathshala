import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, TextInput, View } from "react-native";
import { useLocalSearchParams, router, type Href } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LibraryItemDto, LibrarySectionDto } from "@workspace/api-zod";
import { t } from "@workspace/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/lib/api";
import {
  findItemInTrees,
  findSectionInTrees,
  itemHasText,
  libraryTreesFromCache,
  pickLocalized,
  type LibraryTreePayload,
} from "@/lib/library/helpers";
import { openLibraryExternalUrl } from "@/lib/library/open-external";
import { useLibraryBookmarks } from "@/lib/library/bookmarks";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { formatBytes } from "@/lib/library/downloaded-audio";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { LibraryOfflineBanner } from "@/components/LibraryOfflineBanner";
import { LibraryShortcut } from "@/components/LibraryShortcut";
import { LibraryTextSheet } from "@/components/LibraryTextSheet";
import { LibraryAudioButton } from "@/components/LibraryAudioButton";
import { LibraryOfflineButton } from "@/components/LibraryOfflineButton";
import { LibraryTarjLine } from "@/components/LibraryTarjLine";
import { LibraryPdfButton } from "@/components/LibraryPdfButton";
import { reportLibraryAccess } from "@/lib/library/access-log";
import {
  type GranthAvailabilityMap,
  type GranthTab,
  fetchGranthAvailability,
  fetchGranthDirectory,
  granthDirectoryKey,
  isGranthTab,
  offlineGranthHref,
} from "@/lib/library/granth";
import { EMPTY_DIRECTORY, parseLibraryIds } from "@/lib/library/granth-directory";
import { GranthDirectory } from "@/components/GranthDirectory";

function matchesQuery(
  q: string,
  ...values: Array<string | null | undefined>
): boolean {
  if (!q) return true;
  return values.some((v) => (v ?? "").toLowerCase().includes(q));
}

/**
 * §17.11.4 — the reverse cross-link. An online granth that is also held on a
 * physical shelf says so, and opens the directory filtered to those
 * libraries rather than dumping the whole catalogue on the reader.
 */
function AvailableAtRow({
  sectionId,
  libraryIds,
  count,
}: {
  sectionId: string;
  libraryIds: string[];
  count: number;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const label = hi
    ? `${count} पुस्तकालय${count === 1 ? "" : "ों"} में उपलब्ध`
    : `Available at ${count} ${count === 1 ? "library" : "libraries"}`;
  return (
    <Pressable
      onPress={() => router.push(offlineGranthHref(sectionId, libraryIds) as Href)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 6,
      }}
    >
      <Ionicons name="business-outline" size={15} color={c.primary} />
      <Body style={{ fontSize: 13, lineHeight: 22, color: c.primary, flexShrink: 1 }}>
        {label}
      </Body>
      <Ionicons name="chevron-forward" size={14} color={c.primary} />
    </Pressable>
  );
}

/**
 * §17.11.1 — a granth section is two tabs. Rendered only for type 'granth';
 * every other section type keeps the single-list screen it always had.
 */
function GranthTabs({
  tab,
  onChange,
}: {
  tab: GranthTab;
  onChange: (next: GranthTab) => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const tabs: Array<{ id: GranthTab; label: string }> = [
    { id: "online", label: hi ? "ऑनलाइन ग्रंथ" : "Online Granth" },
    { id: "offline", label: hi ? "ऑफ़लाइन ग्रंथ" : "Offline Granth" },
  ];
  return (
    <Row style={{ gap: 8, marginBottom: 12 }}>
      {tabs.map((t2) => {
        const active = t2.id === tab;
        return (
          <Pressable
            key={t2.id}
            onPress={() => onChange(t2.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t2.label}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 10,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? c.primary : c.border,
              backgroundColor: active ? c.accent : c.card,
            }}
          >
            <Body
              numberOfLines={1}
              style={{
                fontSize: 14,
                lineHeight: 22,
                color: active ? c.primary : c.mutedForeground,
              }}
            >
              {t2.label}
            </Body>
          </Pressable>
        );
      })}
    </Row>
  );
}

/**
 * One action in an item's row.
 *
 * The icon used to stand alone at roughly 38px tall — under the 44px touch
 * floor, and asking a reader to know that a document glyph means "text" and a
 * play glyph means "audio". The label is small but it is there, and the row
 * now clears 44.
 */
function IconAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        minHeight: 44,
        paddingVertical: 6,
        minWidth: 0,
      }}
    >
      <Ionicons name={icon} size={20} color={c.secondary} />
      <Body
        numberOfLines={1}
        style={{ fontSize: 11, lineHeight: 14, color: c.secondary, marginTop: 2 }}
      >
        {label}
      </Body>
    </Pressable>
  );
}

/**
 * "4:07 · 3.8 MB" — what this item is, before committing to it.
 *
 * Duration and size were on LibraryItemDto all along and reached no screen, so
 * a reader on a metered connection had to start the download to find out how
 * big it was. Only downloads over 20MB were announced at all.
 */
function itemMeta(item: LibraryItemDto, hi: boolean): string | null {
  const parts: string[] = [];
  if (item.audio_duration_sec) {
    const m = Math.floor(item.audio_duration_sec / 60);
    const sec = Math.floor(item.audio_duration_sec % 60);
    parts.push(`${m}:${String(sec).padStart(2, "0")}`);
  }
  if (item.audio_size_bytes) parts.push(formatBytes(item.audio_size_bytes));
  if (item.pdf_page_count) {
    parts.push(hi ? `${item.pdf_page_count} पृष्ठ` : `${item.pdf_page_count} pages`);
  } else if (item.pdf_size_bytes) {
    parts.push(formatBytes(item.pdf_size_bytes));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function CollapsibleGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const [open, setOpen] = useState(true);
  if (count === 0) return null;
  return (
    <View style={{ marginBottom: 4 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        style={{
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Title style={{ fontSize: 15, lineHeight: 22, flex: 1, paddingRight: 8 }}>
            {title}
          </Title>
          <Pill label={String(count)} />
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={18}
            color={c.mutedForeground}
            style={{ marginLeft: 8 }}
          />
        </Row>
      </Pressable>
      {open ? <View style={{ marginTop: 10, gap: 8 }}>{children}</View> : null}
      {!open ? (
        <Body muted style={{ fontSize: 12, lineHeight: 22, marginTop: 4 }}>
          {hi ? "विवरण के लिए टैप करें" : "Tap to expand"}
        </Body>
      ) : null}
    </View>
  );
}

function ItemRow({
  item,
  onOpenText,
  availableAt,
}: {
  item: LibraryItemDto;
  onOpenText: (item: LibraryItemDto) => void;
  /** §17.11.4 reverse cross-link — absent when nothing published holds it. */
  availableAt?: { library_count: number; library_ids: string[] };
}) {
  const { hi } = useLocale();
  const c = useColors();
  const { isBookmarked, toggle } = useLibraryBookmarks();
  const bookmarked = isBookmarked(item.id);
  const title = pickLocalized(hi, item.title_en, item.title_hi, item.title_gu);
  const hasAudio = !!item.audio_url;
  const hasVideo = !!item.youtube_url;
  const hasText = itemHasText(item);
  const hasPdf = !!item.pdf_url;
  const hasLink = !!item.external_url;
  const meta = itemMeta(item, hi);

  async function openVideo() {
    const result = await openLibraryExternalUrl(item.youtube_url);
    if (result === "opened") return;
    Alert.alert(
      hi ? "वीडियो नहीं खुला" : "Could not open video",
      hi
        ? "कोई ऐप यह लिंक नहीं खोल सका — YouTube या ब्राउज़र इंस्टॉल करें, फिर फिर से कोशिश करें।"
        : "No app could open this link — install YouTube or a browser, then try again.",
    );
  }

  async function openLink() {
    const result = await openLibraryExternalUrl(item.external_url);
    if (result === "opened") {
      // §17.9 — logged on the tap that actually handed off to the browser,
      // not on a tap that failed to open anything.
      reportLibraryAccess({ itemId: item.id }, "external_link_open");
      return;
    }
    Alert.alert(
      hi ? "लिंक नहीं खुला" : "Could not open link",
      hi
        ? "कोई ऐप यह लिंक नहीं खोल सका — ब्राउज़र इंस्टॉल करें, फिर फिर से कोशिश करें।"
        : "No app could open this link — install a browser, then try again.",
    );
  }

  return (
    <Card>
      <Row style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <Title style={{ fontSize: 15, lineHeight: 22, flex: 1, paddingRight: 4 }}>{title}</Title>
        <Pressable
          onPress={() => void toggle(item.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            bookmarked
              ? hi
                ? "बुकमार्क हटाएँ"
                : "Remove bookmark"
              : hi
                ? "बुकमार्क करें"
                : "Bookmark"
          }
          style={{ paddingTop: 2 }}
        >
          <Ionicons
            name={bookmarked ? "bookmark" : "bookmark-outline"}
            size={20}
            color={bookmarked ? c.primary : c.mutedForeground}
          />
        </Pressable>
      </Row>
      <LibraryTarjLine item={item} style={{ marginTop: 2 }} />
      {meta ? (
        <Body muted style={{ marginTop: 2, fontSize: 12, lineHeight: 18 }}>
          {meta}
        </Body>
      ) : null}
      {availableAt && availableAt.library_count > 0 ? (
        <AvailableAtRow
          sectionId={item.section_id}
          libraryIds={availableAt.library_ids}
          count={availableAt.library_count}
        />
      ) : null}
      {hasAudio || hasVideo || hasText || hasPdf || hasLink ? (
        <Row style={{ marginTop: 10, justifyContent: "space-evenly", alignItems: "center", width: "100%" }}>
          {hasAudio ? (
            <LibraryAudioButton item={item} compact style={{ flex: 1, borderWidth: 0 }} />
          ) : null}
          {hasText ? (
            <IconAction
              icon="document-text-outline"
              label={hi ? "पाठ" : "Text"}
              onPress={() => onOpenText(item)}
            />
          ) : null}
          {/* Mounted only when the item actually has a PDF — an always-present
              button that greys out reads as a broken app, not as absent content. */}
          {hasPdf ? (
            <LibraryPdfButton item={item} compact style={{ flex: 1, borderWidth: 0 }} />
          ) : null}
          {hasVideo ? (
            <IconAction
              icon="logo-youtube"
              label={hi ? "वीडियो" : "Video"}
              onPress={() => void openVideo()}
            />
          ) : null}
          {hasLink ? (
            <IconAction
              icon="open-outline"
              label={hi ? "लिंक खोलें" : "Open link"}
              onPress={() => void openLink()}
            />
          ) : null}
          {hasAudio ? (
            <LibraryOfflineButton item={item} compact style={{ flex: 1, borderWidth: 0 }} />
          ) : null}
        </Row>
      ) : (
        <Body muted style={{ marginTop: 8, fontSize: 13, lineHeight: 22 }}>
          {hi ? "सामग्री शीघ्र उपलब्ध होगी।" : "Content coming soon."}
        </Body>
      )}
    </Card>
  );
}

export default function LibrarySectionScreen() {
  const {
    sectionId: raw,
    itemId: rawItemId,
    tab: rawTab,
    libraryIds: rawLibraryIds,
  } = useLocalSearchParams<{
    sectionId: string;
    itemId?: string | string[];
    tab?: string | string[];
    libraryIds?: string | string[];
  }>();
  const sectionId = String(raw ?? "");
  const itemIdParam = Array.isArray(rawItemId)
    ? String(rawItemId[0] ?? "")
    : String(rawItemId ?? "");
  const { hi, locale } = useLocale();
  const c = useColors();
  const { user } = useAuth();
  const authed = !!user;
  const qc = useQueryClient();
  const [readerItem, setReaderItem] = useState<LibraryItemDto | null>(null);
  const [searchText, setSearchText] = useState("");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const { ids: bookmarkIds } = useLibraryBookmarks();
  const openedItemIdRef = useRef<string | null>(null);
  const tabParam = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const [granthTab, setGranthTab] = useState<GranthTab>(
    isGranthTab(tabParam) ? tabParam : "online",
  );
  const [availability, setAvailability] = useState<GranthAvailabilityMap>({});
  const granthLoggedRef = useRef<string | null>(null);
  // Cross-link arrival: show only the libraries that hold that granth,
  // clearable so the reader is never stuck inside a filter they did not set.
  const [libraryFilter, setLibraryFilter] = useState<string[] | null>(() =>
    parseLibraryIds(rawLibraryIds),
  );

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["library", authed ? "member" : "public"],
    queryFn: () =>
      authed
        ? apiGet<LibraryTreePayload>("/v1/library")
        : apiGet<LibraryTreePayload>("/v1/public/library"),
    // Heal stale persisted trees that lost text after a failed version-sync clear.
    staleTime: 0,
    refetchOnMount: "always",
  });

  const section: LibrarySectionDto | null = useMemo(() => {
    const fromFetch = data ? findSectionInTrees([data], sectionId) : null;
    if (fromFetch) return fromFetch;
    return findSectionInTrees(libraryTreesFromCache(qc), sectionId);
  }, [data, sectionId, qc]);

  // Open text sheet once when navigated with ?itemId= (library search).
  useEffect(() => {
    if (!itemIdParam || !section) return;
    if (openedItemIdRef.current === itemIdParam) return;
    const trees = data ? [data, ...libraryTreesFromCache(qc)] : libraryTreesFromCache(qc);
    const found = findItemInTrees(trees, itemIdParam);
    if (!found || found.section.id !== section.id) return;
    if (!itemHasText(found.item)) return;
    openedItemIdRef.current = itemIdParam;
    setReaderItem(found.item);
  }, [itemIdParam, section, data, qc]);

  // §17.11.2 — a granth section is an ordinary item_list plus a second tab.
  // Behaviour switches on type ONLY; the section's name is data an admin
  // owns and is never read here (v2 rule).
  const isGranth = section?.type === "granth";

  // §17.9 — granth_view on section open. Once per section per mount: the
  // server counts distinct reach anyway, but re-reporting on every render
  // would be a request per keystroke in the search box.
  useEffect(() => {
    if (!isGranth || !section) return;
    if (granthLoggedRef.current === section.id) return;
    granthLoggedRef.current = section.id;
    reportLibraryAccess({ sectionId: section.id }, "granth_view");
  }, [isGranth, section]);

  // §17.11.4 — the directory is cached beside the section tree (the query
  // key sits under "library", which the persist allow-list already covers),
  // so it is fully browsable offline and pre-login.
  const directoryQuery = useQuery({
    queryKey: granthDirectoryKey(sectionId),
    queryFn: () => fetchGranthDirectory(sectionId),
    enabled: isGranth && !!sectionId,
  });

  // §17.11.4 — one lookup per section open, never per card.
  useEffect(() => {
    if (!isGranth || !section) {
      setAvailability({});
      return;
    }
    let cancelled = false;
    void fetchGranthAvailability(section.id).then((map) => {
      if (!cancelled) setAvailability(map);
    });
    return () => {
      cancelled = true;
    };
  }, [isGranth, section]);

  const query = searchText.trim().toLowerCase();

  const filteredSubs = useMemo(() => {
    const subs = section?.subsections ?? [];
    return subs
      .map((sub) => {
        const subHit = !query || matchesQuery(query, sub.name_en, sub.name_hi, sub.name_gu);
        const items = (sub.items ?? []).filter((item) => {
          if (bookmarksOnly && !bookmarkIds.has(item.id)) return false;
          if (!query) return true;
          return (
            subHit ||
            matchesQuery(query, item.title_en, item.title_hi, item.title_gu)
          );
        });
        return { ...sub, items };
      })
      .filter((sub) => (sub.items ?? []).length > 0);
  }, [section, query, bookmarksOnly, bookmarkIds]);

  const filteredLoose = useMemo(() => {
    const items = section?.items ?? [];
    return items.filter((item) => {
      if (bookmarksOnly && !bookmarkIds.has(item.id)) return false;
      if (!query) return true;
      return matchesQuery(query, item.title_en, item.title_hi, item.title_gu);
    });
  }, [section, query, bookmarksOnly, bookmarkIds]);

  if (isLoading && !section) {
    return (
      <Screen>
          <StateView status="loading" emptyText="" />
        </Screen>
    );
  }

  if (isError && !section) {
    return (
      <Screen refreshing={isRefetching} onRefresh={refetch}>
          <StateView
            status="error"
            emptyText=""
            errorText={apiErrorMessage(error, hi)}
            onRetry={() => void refetch()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        </Screen>
    );
  }

  if (!section || (section.type !== "item_list" && section.type !== "granth")) {
    return (
      <Screen>
          <StateView
            status="empty"
            emptyText={hi ? "यह खंड उपलब्ध नहीं है।" : "That section is not available."}
          />
        </Screen>
    );
  }

  if (section.requires_login && !authed) {
    return (
      <Screen>
          <StateView
            status="empty"
            emptyText={
              hi
                ? "साइन इन करें — इस खंड के स्तवन, पाठ और ऑडियो सदस्यों के लिए हैं।"
                : "Sign in to open — the stavans, texts and audio in this section are for members."
            }
          />
          <View style={{ marginTop: 12 }}>
            <Button
              label={hi ? "साइन इन करें" : "Sign in"}
              icon="log-in-outline"
              onPress={() =>
                router.push({
                  pathname: "/auth/sign-in",
                  params: { returnTo: `/library/${section.id}` },
                } as never)
              }
            />
          </View>
        </Screen>
    );
  }

  const title = pickLocalized(hi, section.name_en, section.name_hi, section.name_gu);
  const hasSubs = filteredSubs.length > 0;
  const noMatches =
    (query.length > 0 || bookmarksOnly) &&
    filteredSubs.length === 0 &&
    filteredLoose.length === 0;
  const emptySection = !hasSubs && filteredLoose.length === 0 && !query && !bookmarksOnly;
  // Only a granth section has a second tab to be on.
  const showOffline = isGranth && granthTab === "offline";

  return (
    <>
    <Screen refreshing={isRefetching} onRefresh={refetch} contentStyle={{ paddingBottom: 120 }}>
      <LibraryOfflineBanner />
      <Title style={{ fontSize: 22, lineHeight: 30, marginBottom: 12 }}>{title}</Title>

      {/* Downloads and Bookmarks existed only on library home, so a reader
          three levels in had to back all the way out to reach what they had
          saved. */}
      <Row style={{ gap: 8, marginBottom: 12 }}>
        <LibraryShortcut
          icon="bookmark-outline"
          label={hi ? "बुकमार्क" : "Bookmarks"}
          href="/library/bookmarks"
        />
        <LibraryShortcut
          icon="download-outline"
          label={hi ? "डाउनलोड" : "Downloads"}
          href="/library/downloads"
        />
      </Row>

      {isGranth ? <GranthTabs tab={granthTab} onChange={setGranthTab} /> : null}

      {showOffline ? (
        <GranthDirectory
          sectionId={sectionId}
          directory={directoryQuery.data ?? EMPTY_DIRECTORY}
          viewerCityId={user?.city_id ?? null}
          filterLibraryIds={libraryFilter}
          onClearFilter={() => setLibraryFilter(null)}
          loading={directoryQuery.isLoading}
        />
      ) : null}

      {showOffline ? null : (
      <>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: c.card,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: c.border,
          paddingHorizontal: 12,
          minHeight: 44,
          marginBottom: 12,
        }}
      >
        <Ionicons name="search-outline" size={20} color={c.mutedForeground} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder={hi ? "खोजें…" : "Search…"}
          placeholderTextColor={c.mutedForeground}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={hi ? "खंड खोज" : "Section search"}
          style={{
            flex: 1,
            fontSize: 16,
            lineHeight: 22,
            color: c.foreground,
            paddingVertical: 10,
          }}
        />
        {searchText.length > 0 ? (
          <Pressable
            onPress={() => setSearchText("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={hi ? "साफ़ करें" : "Clear"}
          >
            <Ionicons name="close-circle" size={20} color={c.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <Pressable
        onPress={() => setBookmarksOnly((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ selected: bookmarksOnly }}
        accessibilityLabel={hi ? "केवल बुकमार्क" : "Bookmarks only"}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          marginBottom: 12,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: bookmarksOnly ? c.primary : c.border,
          backgroundColor: bookmarksOnly ? c.accent : c.card,
        }}
      >
        <Ionicons
          name={bookmarksOnly ? "bookmark" : "bookmark-outline"}
          size={16}
          color={bookmarksOnly ? c.primary : c.mutedForeground}
        />
        <Body
          style={{
            fontSize: 13,
            lineHeight: 18,
            color: bookmarksOnly ? c.primary : c.mutedForeground,
          }}
        >
          {hi ? "केवल बुकमार्क" : "Bookmarks only"}
        </Body>
      </Pressable>

      {hasSubs
        ? filteredSubs.map((sub) => {
            const subTitle = pickLocalized(hi, sub.name_en, sub.name_hi, sub.name_gu);
            const items = sub.items ?? [];
            return (
              <CollapsibleGroup key={sub.id} title={subTitle} count={items.length}>
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onOpenText={setReaderItem}
                    availableAt={availability[item.id]}
                  />
                ))}
              </CollapsibleGroup>
            );
          })
        : null}

      {filteredLoose.length > 0 ? (
        hasSubs || (section.subsections ?? []).length > 0 ? (
          <CollapsibleGroup
            title={hi ? "अन्य" : "Other"}
            count={filteredLoose.length}
          >
            {filteredLoose.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onOpenText={setReaderItem}
                availableAt={availability[item.id]}
              />
            ))}
          </CollapsibleGroup>
        ) : (
          <View style={{ gap: 10 }}>
            {filteredLoose.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onOpenText={setReaderItem}
                availableAt={availability[item.id]}
              />
            ))}
          </View>
        )
      ) : null}

      {noMatches ? (
        <StateView
          status="empty"
          emptyText={
            bookmarksOnly && !query
              ? hi
                ? "कोई बुकमार्क नहीं।"
                : "No bookmarked items."
              : hi
                ? "कोई परिणाम नहीं।"
                : "No matching items."
          }
        />
      ) : null}

      {emptySection ? (
        <StateView
          status="empty"
          emptyText={hi ? "इस खंड में अभी कोई सामग्री नहीं है।" : "No items in this section yet."}
        />
      ) : null}
      </>
      )}

      {/*
        §17.10.1 — the same "Request content" action as library home, prefilled
        with this section. A reader who has just looked through a section and
        not found what they wanted is exactly who this is for, so it sits at the
        foot of the list rather than competing with the content above it.
      */}
      <View style={{ marginTop: 8, alignItems: "center" }}>
        <Button
          label={t("libraryRequests.action", locale)}
          icon="add-circle-outline"
          variant="outline"
          compact
          onPress={() =>
            router.push({
              pathname: "/library/request",
              params: { sectionId: String(sectionId) },
            } as never)
          }
        />
      </View>
    </Screen>
      {/* Outside ScrollView — BottomSheetModal fails to present when nested in Screen scroll on iOS */}
      <LibraryTextSheet item={readerItem} onClose={() => setReaderItem(null)} />
    </>
  );
}
