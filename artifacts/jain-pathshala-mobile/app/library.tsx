import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Linking, Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet } from "@/lib/api";
import type { LibraryItem, ListResponse } from "@/lib/types";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  pdf: "document-text-outline",
  video: "play-circle-outline",
  audio: "musical-notes-outline",
  image: "image-outline",
};

export default function LibraryScreen() {
  const c = useColors();
  const { hi } = useLocale();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["public-library"],
    queryFn: () => apiGet<ListResponse<LibraryItem>>("/v1/public/library?limit=60"),
  });

  const items = data?.items ?? [];

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      {isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : isError ? (
        <StateView status="error" emptyText="" errorText={hi ? "पुस्तकालय लोड नहीं हुआ।" : "Could not load the library."} onRetry={refetch} retryLabel={hi ? "पुनः प्रयास करें" : "Try again"} />
      ) : items.length === 0 ? (
        <StateView status="empty" emptyText={hi ? "अभी कोई संसाधन नहीं है।" : "No resources available yet."} />
      ) : (
        items.map((item) => {
          const title = hi && item.title_hi ? item.title_hi : item.title_en;
          const desc = hi && item.description_hi ? item.description_hi : item.description_en;
          const icon = ICONS[item.content_type] ?? "document-outline";
          return (
            <Card key={item.id}>
              <Row style={{ gap: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={icon} size={22} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Title style={{ fontSize: 16 }}>{title}</Title>
                  <View style={{ marginTop: 4 }}>
                    <Pill label={item.content_type.toUpperCase()} />
                  </View>
                </View>
              </Row>
              {desc ? <Body muted style={{ marginTop: 10 }}>{desc}</Body> : null}
              {item.embed_url ? (
                <Button label={hi ? "देखें" : "Watch"} icon="open-outline" variant="outline" onPress={() => Linking.openURL(item.embed_url!)} style={{ marginTop: 12 }} />
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
