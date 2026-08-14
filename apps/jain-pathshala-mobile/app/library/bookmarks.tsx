import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/lib/api";
import { useLibraryBookmarks } from "@/lib/library/bookmarks";
import {
  itemHasText,
  libraryTreesFromCache,
  listItemsInTrees,
  pickLocalized,
  type LibraryTreePayload,
} from "@/lib/library/helpers";
import { Body, Card, Row, Screen, StateView, Title } from "@/components/ui";

export default function LibraryBookmarksScreen() {
  const { hi } = useLocale();
  const c = useColors();
  const { user } = useAuth();
  const authed = !!user;
  const qc = useQueryClient();
  const { ids, isBookmarked, toggle } = useLibraryBookmarks();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["library", authed ? "member" : "public"],
    queryFn: () =>
      authed
        ? apiGet<LibraryTreePayload>("/v1/library")
        : apiGet<LibraryTreePayload>("/v1/public/library"),
  });

  const trees = data ? [data, ...libraryTreesFromCache(qc)] : libraryTreesFromCache(qc);
  const rows = listItemsInTrees(trees).filter(({ item }) => ids.has(item.id));

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()} contentStyle={{ paddingBottom: 120 }}>
        {isLoading && rows.length === 0 ? (
          <StateView status="loading" emptyText="" />
        ) : isError && rows.length === 0 ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "बुकमार्क लोड नहीं हुए।" : "Could not load bookmarks."}
            onRetry={() => void refetch()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : rows.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "अभी कोई बुकमार्क नहीं। किसी स्तवन कार्ड पर बुकमार्क टैप करें।"
                : "No bookmarks yet. Tap the bookmark on an item card to save it here."
            }
          />
        ) : (
          rows.map(({ section, item }) => {
            const title = pickLocalized(hi, item.title_en, item.title_hi, item.title_gu);
            const sectionTitle = pickLocalized(
              hi,
              section.name_en,
              section.name_hi,
              section.name_gu,
            );
            return (
              <Card key={item.id}>
                <Row style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <Pressable
                    onPress={() => {
                      const qs = itemHasText(item) ? `?itemId=${item.id}` : "";
                      router.push(`/library/${section.id}${qs}` as Href);
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                    accessibilityRole="button"
                    accessibilityLabel={title}
                  >
                    <Title style={{ fontSize: 15, lineHeight: 22 }}>{title}</Title>
                    <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 20 }}>
                      {sectionTitle}
                    </Body>
                  </Pressable>
                  <Pressable
                    onPress={() => void toggle(item.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={
                      isBookmarked(item.id)
                        ? hi
                          ? "बुकमार्क हटाएँ"
                          : "Remove bookmark"
                        : hi
                          ? "बुकमार्क करें"
                          : "Bookmark"
                    }
                  >
                    <Ionicons
                      name={isBookmarked(item.id) ? "bookmark" : "bookmark-outline"}
                      size={20}
                      color={isBookmarked(item.id) ? c.primary : c.mutedForeground}
                    />
                  </Pressable>
                </Row>
              </Card>
            );
          })
        )}
      </Screen>
  );
}
