import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, TextInput, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import type { LibrarySectionDto } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet } from "@/lib/api";
import { safeHref } from "@/lib/safe-url";
import { pickLocalized, type LibraryTreePayload } from "@/lib/library/helpers";
import {
  ensureLibrarySearchIndex,
  preferredLibraryTree,
  searchLibrary,
} from "@/lib/library/search-index";
import type { SearchHit } from "@/lib/library/search-query";
import { AppHeader } from "@/components/AppHeader";
import { LibrarySearchResults } from "@/components/LibrarySearchResults";
import { Body, Card, Row, Screen, StateView, Title } from "@/components/ui";

export type LibraryViewProps = {
  headerRight?: ReactNode;
  /** False on the shared stack route so Expo's back header is the chrome. */
  showAppHeader?: boolean;
};

/** In-app destination for a section after (optional) login. */
export function sectionDestination(section: LibrarySectionDto): string | null {
  if (section.type === "item_list") return `/library/${section.id}`;
  if (section.type === "panchang") return "/panchang";
  if (section.type === "deeplink") {
    const target = section.deeplink_target?.trim();
    if (target?.startsWith("/") && !target.startsWith("//")) return target;
  }
  return null;
}

function openSection(section: LibrarySectionDto, guest: boolean) {
  // Panchang is never login-gated (product rule).
  const needsLogin = section.requires_login && guest && section.type !== "panchang";

  if (needsLogin) {
    const returnTo = sectionDestination(section);
    router.push({
      pathname: "/auth/phone",
      params: returnTo ? { returnTo } : {},
    } as never);
    return;
  }

  // Behaviour is driven only by type — never by name or key.
  if (section.type === "item_list") {
    router.push(`/library/${section.id}` as Href);
    return;
  }
  if (section.type === "panchang") {
    router.push("/panchang" as Href);
    return;
  }
  if (section.type === "deeplink") {
    const target = section.deeplink_target?.trim();
    if (!target) return;
    if (target.startsWith("/")) {
      router.push(target as Href);
      return;
    }
    const safe = safeHref(target);
    if (safe) void Linking.openURL(safe);
  }
}

function navigateSearchHit(hit: SearchHit) {
  if (hit.resultKind === "panchang") {
    router.push("/panchang" as Href);
    return;
  }
  if (!hit.sectionId) return;
  if (hit.isTextMatch && hit.itemId) {
    router.push(`/library/${hit.sectionId}?itemId=${hit.itemId}` as Href);
    return;
  }
  router.push(`/library/${hit.sectionId}` as Href);
}

/**
 * Shared digital-library home for guest / parent / student.
 * Tree is persisted offline via query-persist allow-list on ["library", …].
 */
export function LibraryView({ headerRight, showAppHeader = true }: LibraryViewProps = {}) {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const authed = !!user;
  const qc = useQueryClient();

  const [searchText, setSearchText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["library", authed ? "member" : "public"],
    queryFn: () =>
      authed
        ? apiGet<LibraryTreePayload>("/v1/library")
        : apiGet<LibraryTreePayload>("/v1/public/library"),
  });
  const sections = (data?.sections ?? []).filter(
    (s) => !(authed && s.key === "pathshala_join"),
  );

  // Bootstrap FTS if empty but tree cache is already populated (race before sync).
  useEffect(() => {
    const tree = preferredLibraryTree(qc) ?? data;
    if (!tree?.sections?.length) return;
    void ensureLibrarySearchIndex(tree).catch(() => {
      /* best-effort */
    });
  }, [qc, data]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchText.trim()), 200);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    if (!debouncedQuery) {
      setHits([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void searchLibrary(debouncedQuery, hi)
      .then((rows) => {
        if (!cancelled) setHits(rows);
      })
      .catch(() => {
        if (!cancelled) setHits([]);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, hi]);

  const onPressHit = useCallback((hit: SearchHit) => {
    navigateSearchHit(hit);
  }, []);

  const searching = debouncedQuery.length > 0;

  const downloadsBtn = (
    <Pressable
      onPress={() => router.push("/library/downloads" as Href)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={hi ? "डाउनलोड" : "Downloads"}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.muted,
      }}
    >
      <Ionicons name="download-outline" size={22} color={c.secondary} />
    </Pressable>
  );

  const bookmarksBtn = (
    <Pressable
      onPress={() => router.push("/library/bookmarks" as Href)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={hi ? "बुकमार्क" : "Bookmarks"}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.muted,
      }}
    >
      <Ionicons name="bookmark-outline" size={22} color={c.secondary} />
    </Pressable>
  );

  const right = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {bookmarksBtn}
      {downloadsBtn}
      {headerRight ?? null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {showAppHeader ? (
        <AppHeader
          title={hi ? "पुस्तकालय" : "Digital library"}
          subtitle={hi ? "ग्रंथ, स्तवन और संसाधन" : "Scriptures, stavans and resources"}
          right={right}
        />
      ) : null}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          backgroundColor: c.background,
        }}
      >
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
            accessibilityLabel={hi ? "पुस्तकालय खोज" : "Library search"}
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
        {showAppHeader ? null : (
          <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            {bookmarksBtn}
            {downloadsBtn}
          </View>
        )}
      </View>
      <Screen refreshing={isRefetching} onRefresh={refetch} contentStyle={{ paddingBottom: 110 }}>
        {searching ? (
          <LibrarySearchResults
            hits={hits}
            loading={searchLoading}
            onPressHit={onPressHit}
          />
        ) : isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "पुस्तकालय लोड नहीं हुआ।" : "Could not load the library."}
            onRetry={() => void refetch()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : sections.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "अभी कोई खंड नहीं है।" : "No sections available yet."}
          />
        ) : (
          sections.map((section) => {
            const title = pickLocalized(hi, section.name_en, section.name_hi, section.name_gu);
            const showLoginHint =
              section.requires_login && !authed && section.type !== "panchang";
            const chevron = showLoginHint
              ? "lock-closed-outline"
              : section.type === "deeplink"
                ? "open-outline"
                : section.type === "panchang"
                  ? "calendar-outline"
                  : "chevron-forward";
            return (
              <Pressable
                key={section.id}
                onPress={() => openSection(section, !authed)}
                accessibilityRole="button"
                accessibilityLabel={title}
              >
                <Card>
                  <Row style={{ gap: 12, alignItems: "center" }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        backgroundColor: c.accent,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name={
                          section.type === "panchang"
                            ? "calendar-outline"
                            : section.type === "deeplink"
                              ? "link-outline"
                              : "library-outline"
                        }
                        size={22}
                        color={c.primary}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Title style={{ fontSize: 16, lineHeight: 22 }}>{title}</Title>
                      {showLoginHint ? (
                        <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 22 }}>
                          {hi ? "लॉगिन आवश्यक" : "Sign in required"}
                        </Body>
                      ) : null}
                    </View>
                    <Ionicons name={chevron} size={20} color={c.mutedForeground} />
                  </Row>
                </Card>
              </Pressable>
            );
          })
        )}
      </Screen>
    </View>
  );
}
