import { useCallback, useEffect, useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { bodyFamily, fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useCentres } from "@/lib/queries";
import type { CentreRow } from "@/lib/types";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

/** Flattened state-header / centre rows so FlatList can virtualise (GST-PRF-02). */
type BrowseRow =
  | { kind: "header"; key: string; state: string }
  | { kind: "centre"; key: string; centre: CentreRow };

export function CentresBrowseScreen({ tabBarInset = false }: { tabBarInset?: boolean }) {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();

  // Server-side ?q= search + offset paging (re-review finding 2): the flat
  // fetch was clamped, so centre 201 silently never appeared.
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useCentres(debouncedQuery);
  const items = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.data.items ?? []),
    [data?.pages],
  );

  const rows = useMemo<BrowseRow[]>(() => {
    const groups = new Map<string, CentreRow[]>();
    for (const item of items) {
      const key = item.state_name ?? "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    const out: BrowseRow[] = [];
    for (const [state, list] of groups) {
      out.push({ kind: "header", key: `h:${state}`, state });
      for (const centre of list) out.push({ kind: "centre", key: centre.id, centre });
    }
    return out;
  }, [items]);

  const renderItem = useCallback<ListRenderItem<BrowseRow>>(
    ({ item }) => {
      if (item.kind === "header") {
        return (
          <Text
            style={{
              fontFamily: bodyFamily(hi, "semibold"),
              fontSize: 13,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: c.mutedForeground,
              marginTop: 6,
            }}
          >
            {item.state}
          </Text>
        );
      }
      const centre = item.centre;
      return (
        <Pressable onPress={() => router.push(`/centre/${centre.id}`)}>
          {({ pressed }) => (
            <Card style={{ opacity: pressed ? 0.85 : 1 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Title style={{ fontSize: 18 }}>{centre.name}</Title>
                  <Body muted style={{ marginTop: 4 }}>
                    {[centre.locality, centre.city_name].filter(Boolean).join(", ") || "—"}
                  </Body>
                  <View style={{ marginTop: 10 }}>
                    <Pill
                      tone="primary"
                      label={`${centre.batch_count} ${hi ? "बैच" : centre.batch_count === 1 ? "batch" : "batches"}`}
                    />
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.inkDim} />
              </Row>
            </Card>
          )}
        </Pressable>
      );
    },
    [c, hi, router],
  );

  return (
    <ActivityThemed accent="centres">
      {tabBarInset ? (
        <AppHeader
          title={hi ? "अपने पास की पाठशाला खोजें" : "Find a Pathshala near you"}
          subtitle={hi ? "मेघ संस्कार वाटिका नेटवर्क के सक्रिय केंद्र" : "Active centres across the Megh Sanskar Vatika network"}
        />
      ) : null}
      <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0, paddingBottom: 0 }}>
        <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={hi ? "नाम, इलाक़ा या शहर खोजें…" : "Search by name, locality or city…"}
            placeholderTextColor={c.inkDim}
            style={{
              borderWidth: 1,
              borderColor: c.input,
              borderRadius: c.radius,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontFamily: fonts.body,
              color: c.foreground,
              backgroundColor: c.card,
            }}
          />
        </View>
        {isLoading ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView status="loading" emptyText="" />
          </View>
        ) : isError ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "केंद्र लोड नहीं हो सके।" : "Could not load centres."}
              onRetry={refetch}
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={renderItem}
            ListEmptyComponent={
              <StateView
                status="empty"
                emptyText={
                  debouncedQuery
                    ? hi
                      ? "इस खोज से कोई केंद्र नहीं मिला।"
                      : "No centres match that search."
                    : hi
                      ? "अभी कोई केंद्र उपलब्ध नहीं है।"
                      : "No centres available yet."
                }
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
                        ? "और केंद्र देखें"
                        : "Load more centres"
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
              gap: 10,
            }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching && !isFetchingNextPage}
                onRefresh={refetch}
                tintColor={c.primary}
                colors={[c.primary]}
              />
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}
      </Screen>
    </ActivityThemed>
  );
}
