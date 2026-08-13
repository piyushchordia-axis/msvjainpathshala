import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, TextInput, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LibraryItemDto, LibrarySectionDto } from "@workspace/api-zod";
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
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { LibraryTextSheet } from "@/components/LibraryTextSheet";
import { LibraryAudioButton } from "@/components/LibraryAudioButton";
import { LibraryOfflineButton } from "@/components/LibraryOfflineButton";

function matchesQuery(
  q: string,
  ...values: Array<string | null | undefined>
): boolean {
  if (!q) return true;
  return values.some((v) => (v ?? "").toLowerCase().includes(q));
}

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
        paddingVertical: 8,
        minWidth: 0,
      }}
    >
      <Ionicons name={icon} size={22} color={c.secondary} />
    </Pressable>
  );
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
    <Card style={{ backgroundColor: c.muted }}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button">
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
    </Card>
  );
}

function ItemRow({
  item,
  onOpenText,
}: {
  item: LibraryItemDto;
  onOpenText: (item: LibraryItemDto) => void;
}) {
  const { hi } = useLocale();
  const c = useColors();
  const { isBookmarked, toggle } = useLibraryBookmarks();
  const bookmarked = isBookmarked(item.id);
  const title = pickLocalized(hi, item.title_en, item.title_hi, item.title_gu);
  const hasAudio = !!item.audio_url;
  const hasVideo = !!item.youtube_url;
  const hasText = itemHasText(item);

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
      {hasAudio || hasVideo || hasText ? (
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
          {hasVideo ? (
            <IconAction
              icon="logo-youtube"
              label={hi ? "वीडियो" : "Video"}
              onPress={() => void openVideo()}
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
  const { sectionId: raw, itemId: rawItemId } = useLocalSearchParams<{
    sectionId: string;
    itemId?: string | string[];
  }>();
  const sectionId = String(raw ?? "");
  const itemIdParam = Array.isArray(rawItemId)
    ? String(rawItemId[0] ?? "")
    : String(rawItemId ?? "");
  const { hi } = useLocale();
  const c = useColors();
  const { user } = useAuth();
  const authed = !!user;
  const qc = useQueryClient();
  const [readerItem, setReaderItem] = useState<LibraryItemDto | null>(null);
  const [searchText, setSearchText] = useState("");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const { ids: bookmarkIds } = useLibraryBookmarks();
  const openedItemIdRef = useRef<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
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
      <ActivityThemed accent="library">
        <Screen>
          <StateView status="loading" emptyText="" />
        </Screen>
      </ActivityThemed>
    );
  }

  if (isError && !section) {
    return (
      <ActivityThemed accent="library">
        <Screen refreshing={isRefetching} onRefresh={refetch}>
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "खंड लोड नहीं हुआ।" : "Could not load this section."}
            onRetry={() => void refetch()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        </Screen>
      </ActivityThemed>
    );
  }

  if (!section || section.type !== "item_list") {
    return (
      <ActivityThemed accent="library">
        <Screen>
          <StateView
            status="empty"
            emptyText={hi ? "यह खंड उपलब्ध नहीं है।" : "That section is not available."}
          />
        </Screen>
      </ActivityThemed>
    );
  }

  if (section.requires_login && !authed) {
    return (
      <ActivityThemed accent="library">
        <Screen>
          <StateView
            status="empty"
            emptyText={
              hi
                ? "इस खंड के लिए साइन इन करें।"
                : "Sign in to open this section."
            }
          />
          <View style={{ marginTop: 12 }}>
            <Button
              label={hi ? "साइन इन करें" : "Sign in"}
              icon="log-in-outline"
              onPress={() =>
                router.push({
                  pathname: "/auth/phone",
                  params: { returnTo: `/library/${section.id}` },
                } as never)
              }
            />
          </View>
        </Screen>
      </ActivityThemed>
    );
  }

  const title = pickLocalized(hi, section.name_en, section.name_hi, section.name_gu);
  const hasSubs = filteredSubs.length > 0;
  const noMatches =
    (query.length > 0 || bookmarksOnly) &&
    filteredSubs.length === 0 &&
    filteredLoose.length === 0;
  const emptySection = !hasSubs && filteredLoose.length === 0 && !query && !bookmarksOnly;

  return (
    <ActivityThemed accent="library">
    <>
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      <Title style={{ fontSize: 22, lineHeight: 30, marginBottom: 12 }}>{title}</Title>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: c.muted,
          borderRadius: c.radius,
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
                  <ItemRow key={item.id} item={item} onOpenText={setReaderItem} />
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
              <ItemRow key={item.id} item={item} onOpenText={setReaderItem} />
            ))}
          </CollapsibleGroup>
        ) : (
          <View style={{ gap: 10 }}>
            {filteredLoose.map((item) => (
              <ItemRow key={item.id} item={item} onOpenText={setReaderItem} />
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
    </Screen>
      {/* Outside ScrollView — BottomSheetModal fails to present when nested in Screen scroll on iOS */}
      <LibraryTextSheet item={readerItem} onClose={() => setReaderItem(null)} />
    </>
    </ActivityThemed>
  );
}
