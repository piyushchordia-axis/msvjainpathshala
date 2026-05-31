import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet } from "@/lib/api";
import type { GalleryItem, ListResponse } from "@/lib/types";
import { Body, Card, Pill, Screen, StateView, Title } from "@/components/ui";
import { Text } from "react-native";

const SWATCHES = ["#D4621A", "#761919", "#C8941F", "#A8470F", "#6B1212"];

export default function GalleryScreen() {
  const c = useColors();
  const { hi } = useLocale();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["public-gallery"],
    queryFn: () => apiGet<ListResponse<GalleryItem>>("/v1/gallery?limit=60"),
  });

  const items = data?.items ?? [];

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      <Title style={{ fontSize: 22 }}>{hi ? "हमारे बच्चों का पुण्य" : "Punya from our children"}</Title>
      {isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : isError ? (
        <StateView status="error" emptyText="" errorText={hi ? "लोड नहीं हो सका।" : "Could not load the gallery."} onRetry={refetch} retryLabel={hi ? "पुनः प्रयास करें" : "Try again"} />
      ) : items.length === 0 ? (
        <StateView status="empty" emptyText={hi ? "अभी कुछ साझा नहीं किया गया है।" : "Nothing shared yet."} />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {items.map((item, i) => {
            const niyam = hi && item.niyam_title_hi ? item.niyam_title_hi : item.niyam_title_en;
            const bg = SWATCHES[i % SWATCHES.length];
            return (
              <Card key={item.id} style={{ width: "47%", padding: 0, overflow: "hidden" }}>
                <View style={{ backgroundColor: bg, height: 92, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }}>
                  <Text style={{ fontFamily: fonts.display, fontSize: 22, color: "#FFFFFF", textAlign: "center" }} numberOfLines={1}>
                    {item.first_name}
                  </Text>
                </View>
                <View style={{ padding: 12, gap: 6 }}>
                  {item.is_featured ? <Pill tone="warning" label={hi ? "विशेष" : "Featured"} /> : null}
                  {niyam ? <Body style={{ fontSize: 13 }} numberOfLines={2}>{niyam}</Body> : null}
                  {item.age_group ? <Body muted style={{ fontSize: 12 }}>{item.age_group}</Body> : null}
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
