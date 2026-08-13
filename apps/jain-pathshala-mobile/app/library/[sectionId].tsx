import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, View } from "react-native";
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
import { formatBytes } from "@/lib/library/downloaded-audio";
import {
  resolveAudioButtonState,
  useLibraryDownload,
} from "@/contexts/LibraryDownloadContext";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { LibraryTextSheet } from "@/components/LibraryTextSheet";
import { LibraryAudioButton } from "@/components/LibraryAudioButton";
import { LibraryOfflineButton } from "@/components/LibraryOfflineButton";

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
      <Title style={{ fontSize: 15, lineHeight: 22 }}>{title}</Title>
      {hasAudio || hasVideo || hasText ? (
        <Row style={{ marginTop: 10, gap: 6, flexWrap: "nowrap", width: "100%" }}>
          {hasAudio ? <LibraryAudioButton item={item} style={{ flex: 1 }} /> : null}
          {hasText ? (
            <Button
              label={hi ? "पाठ" : "Text"}
              icon="document-text-outline"
              variant="outline"
              compact
              style={{ flex: 1, minWidth: 0 }}
              onPress={() => onOpenText(item)}
            />
          ) : null}
          {hasVideo ? (
            <Button
              label={hi ? "वीडियो" : "Video"}
              icon="play-circle-outline"
              variant="outline"
              compact
              style={{ flex: 1, minWidth: 0 }}
              onPress={() => void openVideo()}
            />
          ) : null}
          {hasAudio ? <LibraryOfflineButton item={item} style={{ flex: 1 }} /> : null}
        </Row>
      ) : (
        <Body muted style={{ marginTop: 8, fontSize: 13, lineHeight: 22 }}>
          {hi ? "सामग्री शीघ्र उपलब्ध होगी।" : "Content coming soon."}
        </Body>
      )}
    </Card>
  );
}

function collectAudioItems(section: LibrarySectionDto): LibraryItemDto[] {
  const out: LibraryItemDto[] = [];
  for (const sub of section.subsections ?? []) {
    for (const item of sub.items ?? []) {
      if (item.audio_url) out.push(item);
    }
  }
  for (const item of section.items ?? []) {
    if (item.audio_url) out.push(item);
  }
  return out;
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
  const { user } = useAuth();
  const authed = !!user;
  const qc = useQueryClient();
  const [readerItem, setReaderItem] = useState<LibraryItemDto | null>(null);
  const openedItemIdRef = useRef<string | null>(null);
  const { getRow, enqueue } = useLibraryDownload();

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
          errorText={hi ? "खंड लोड नहीं हुआ।" : "Could not load this section."}
          onRetry={() => void refetch()}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      </Screen>
    );
  }

  if (!section || section.type !== "item_list") {
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
    );
  }

  const title = pickLocalized(hi, section.name_en, section.name_hi, section.name_gu);
  const subsections = section.subsections ?? [];
  const looseItems = section.items ?? [];
  const hasSubs = subsections.length > 0;
  const audioItems = collectAudioItems(section);
  const pendingAudio = audioItems.filter((item) => {
    const state = resolveAudioButtonState(getRow(item.id), item.content_version);
    return state !== "ready" && state !== "queued" && state !== "downloading";
  });

  function confirmDownloadAll() {
    if (pendingAudio.length === 0) {
      Alert.alert(
        hi ? "पहले से डाउनलोड" : "Already downloaded",
        hi ? "इस खंड का ऑडियो पहले से उपलब्ध है।" : "Audio in this section is already on your device.",
      );
      return;
    }
    const known = pendingAudio.reduce((acc, i) => acc + (i.audio_size_bytes ?? 0), 0);
    const unknown = pendingAudio.filter((i) => i.audio_size_bytes == null).length;
    const sizeLine =
      known > 0
        ? formatBytes(known) +
          (unknown > 0
            ? hi
              ? ` (+${unknown} अज्ञात आकार)`
              : ` (+${unknown} unknown size)`
            : "")
        : hi
          ? "आकार अज्ञात"
          : "Size unknown";
    Alert.alert(
      hi ? "सभी डाउनलोड करें?" : "Download all audio?",
      hi
        ? `${pendingAudio.length} फ़ाइलें · कुल लगभग ${sizeLine}`
        : `${pendingAudio.length} file(s) · about ${sizeLine}`,
      [
        { text: hi ? "रद्द" : "Cancel", style: "cancel" },
        {
          text: hi ? "डाउनलोड" : "Download",
          onPress: () => {
            for (const item of pendingAudio) void enqueue(item);
          },
        },
      ],
    );
  }

  return (
    <>
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      <Title style={{ fontSize: 22, lineHeight: 30, marginBottom: 12 }}>{title}</Title>

      {audioItems.length > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <Button
            label={hi ? "सभी डाउनलोड" : "Download all"}
            icon="cloud-download-outline"
            variant="outline"
            onPress={confirmDownloadAll}
          />
        </View>
      ) : null}

      {hasSubs
        ? subsections.map((sub) => {
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

      {looseItems.length > 0 ? (
        hasSubs ? (
          <CollapsibleGroup
            title={hi ? "अन्य" : "Other"}
            count={looseItems.length}
          >
            {looseItems.map((item) => (
              <ItemRow key={item.id} item={item} onOpenText={setReaderItem} />
            ))}
          </CollapsibleGroup>
        ) : (
          <View style={{ gap: 10 }}>
            {looseItems.map((item) => (
              <ItemRow key={item.id} item={item} onOpenText={setReaderItem} />
            ))}
          </View>
        )
      ) : null}

      {!hasSubs && looseItems.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "इस खंड में अभी कोई सामग्री नहीं है।" : "No items in this section yet."}
        />
      ) : null}
    </Screen>
      {/* Outside ScrollView — BottomSheetModal fails to present when nested in Screen scroll on iOS */}
      <LibraryTextSheet item={readerItem} onClose={() => setReaderItem(null)} />
    </>
  );
}
