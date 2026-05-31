import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet } from "@/lib/api";
import type { CentreListItem, ListResponse } from "@/lib/types";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { Text } from "react-native";

export default function CentresScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["public-centres"],
    queryFn: () => apiGet<ListResponse<CentreListItem>>("/v1/public/centres"),
  });

  const items = data?.items ?? [];

  // Group by state then city, mirroring the web layout.
  const groups = new Map<string, CentreListItem[]>();
  for (const item of items) {
    const key = item.state_name ?? "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "अपने पास की पाठशाला खोजें" : "Find a Pathshala near you"}
        subtitle={hi ? "मेघ संस्कार वाटिका नेटवर्क के सक्रिय केंद्र" : "Active centres across the Megh Sanskar Vatika network"}
      />
      <Screen refreshing={isRefetching} onRefresh={refetch} contentStyle={{ paddingBottom: 110 }}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView status="error" emptyText="" errorText={hi ? "केंद्र लोड नहीं हो सके।" : "Could not load centres."} onRetry={refetch} retryLabel={hi ? "पुनः प्रयास करें" : "Try again"} />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "अभी कोई केंद्र उपलब्ध नहीं है।" : "No centres available yet."} />
        ) : (
          [...groups.entries()].map(([state, list]) => (
            <View key={state} style={{ gap: 10 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: c.mutedForeground, marginTop: 6 }}>
                {state}
              </Text>
              {list.map((centre) => (
                <Pressable key={centre.id} onPress={() => router.push(`/centre/${centre.id}`)}>
                  {({ pressed }) => (
                    <Card style={{ opacity: pressed ? 0.85 : 1 }}>
                      <Row style={{ justifyContent: "space-between" }}>
                        <View style={{ flex: 1, paddingRight: 10 }}>
                          <Title style={{ fontSize: 18 }}>{centre.name}</Title>
                          <Body muted style={{ marginTop: 4 }}>
                            {[centre.locality, centre.city_name].filter(Boolean).join(", ") || "—"}
                          </Body>
                          <View style={{ marginTop: 10 }}>
                            <Pill tone="primary" label={`${centre.batch_count} ${hi ? "बैच" : centre.batch_count === 1 ? "batch" : "batches"}`} />
                          </View>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={c.inkDim} />
                      </Row>
                    </Card>
                  )}
                </Pressable>
              ))}
            </View>
          ))
        )}
      </Screen>
    </View>
  );
}
