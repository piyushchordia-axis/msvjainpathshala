import { useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, View, type ListRenderItem } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useShivirs } from "@/lib/queries";
import type { ShivirRow } from "@/lib/types";
import { formatDateRange } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

function truncate(text: string, n: number) {
  return text.length > n ? `${text.slice(0, n).trim()}…` : text;
}

type ShivirItem = ShivirRow;

export function ShivirsBrowseScreen({ tabBarInset = false }: { tabBarInset?: boolean }) {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useShivirs();
  const items = (data?.pages ?? []).flatMap((p) => p.data.items ?? []);

  // FlatList so long shivir lists virtualise instead of mounting every card
  // inside one ScrollView (GST-PRF-02).
  const renderItem = useCallback<ListRenderItem<ShivirItem>>(
    ({ item: shivir }) => {
      // Fall back to English when a shivir has no Devanagari yet — a blank card
      // would be worse than an untranslated one.
      const name = (hi ? shivir.name_hi : null) ?? shivir.name_en;
      const description = (hi ? shivir.description_hi : null) ?? shivir.description_en;
      return (
        <Pressable onPress={() => router.push(`/shivir/${shivir.id}`)}>
          {({ pressed }) => (
            <Card style={{ opacity: pressed ? 0.85 : 1 }}>
              <Row style={{ gap: 8, alignItems: "flex-start" }}>
                <Title style={{ fontSize: 19, flex: 1 }}>{name}</Title>
                {shivir.msv_only ? (
                  <Pill tone="warning" label={hi ? "केवल एमएसवी" : "MSV only"} />
                ) : null}
              </Row>
              {description ? (
                <Body muted style={{ marginTop: 6 }}>{truncate(description, 120)}</Body>
              ) : null}
              <Row style={{ marginTop: 12, gap: 6 }}>
                <Ionicons name="calendar-outline" size={15} color={c.primary} />
                <Body style={{ fontSize: 13, color: c.primary }}>
                  {formatDateRange(shivir.start_date, shivir.end_date)}
                </Body>
              </Row>
              <Row style={{ marginTop: 6, gap: 6 }}>
                <Ionicons name="location-outline" size={15} color={c.mutedForeground} />
                <Body muted style={{ fontSize: 13 }}>
                  {[shivir.location_text, shivir.city_name].filter(Boolean).join(", ") || "—"}
                </Body>
              </Row>
            </Card>
          )}
        </Pressable>
      );
    },
    [c, hi, router],
  );

  return (
    <ActivityThemed accent="shivirs">
      {tabBarInset ? (
        <AppHeader
          title={hi ? "शिविर" : "Shivirs & camps"}
          subtitle={hi ? "नेटवर्क भर में शिविर और रिट्रीट" : "Camps and retreats across the network"}
        />
      ) : null}
      <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0, paddingBottom: 0 }}>
        {isLoading ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView status="loading" emptyText="" />
          </View>
        ) : isError ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "शिविर लोड नहीं हो सके।" : "Could not load shivirs."}
              onRetry={refetch}
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(shivir) => shivir.id}
            renderItem={renderItem}
            ListEmptyComponent={
              <StateView
                status="empty"
                emptyText={hi ? "अभी कोई आगामी शिविर नहीं है।" : "No upcoming shivirs right now."}
              />
            }
            ListFooterComponent={
              hasNextPage ? (
                <Button
                  label={
                    isFetchingNextPage
                      ? hi
                        ? "लोड हो रहा है…"
                        : "Loading…"
                      : hi
                        ? "और शिविर देखें"
                        : "Load more shivirs"
                  }
                  variant="outline"
                  onPress={() => void fetchNextPage()}
                  loading={isFetchingNextPage}
                  style={{ marginTop: 4 }}
                />
              ) : null
            }
            contentContainerStyle={{
              paddingHorizontal: 18,
              paddingTop: 8,
              paddingBottom: tabBarInset ? 110 : 40,
              gap: 14,
            }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching && !isFetchingNextPage}
                onRefresh={refetch}
                tintColor={c.primary}
                colors={[c.primary]}
              />
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </Screen>
    </ActivityThemed>
  );
}
