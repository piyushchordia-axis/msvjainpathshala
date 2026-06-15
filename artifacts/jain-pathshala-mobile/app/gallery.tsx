import { useQuery } from "@tanstack/react-query";
import { Image, View } from "react-native";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet } from "@/lib/api";
import type { GalleryItem, ListResponse } from "@/lib/types";
import { Body, Card, Pill, Screen, StateView, Title } from "@/components/ui";
import { Text } from "react-native";

/**
 * The API now returns real media (image_url / thumbnail_url + bilingual
 * caption). Until the shared api-zod contract is regenerated, extend the
 * existing GalleryItem locally so the screen can render the new fields.
 * Consent (only opted-in families' student photos) is enforced server-side.
 */
type MediaGalleryItem = GalleryItem & {
  image_url?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  caption_hi?: string | null;
};

export default function GalleryScreen() {
  const c = useColors();
  const { hi } = useLocale();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["public-gallery"],
    queryFn: () => apiGet<ListResponse<MediaGalleryItem>>("/v1/gallery?limit=60"),
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
          {items.map((item) => {
            const niyam = hi && item.niyam_title_hi ? item.niyam_title_hi : item.niyam_title_en;
            const caption = (hi ? item.caption_hi : item.caption) || item.caption || niyam;
            const uri = item.thumbnail_url ?? item.image_url ?? null;
            return (
              <Card key={item.id} style={{ width: "47%", padding: 0, overflow: "hidden" }}>
                {uri ? (
                  <Image
                    source={{ uri }}
                    style={{ width: "100%", height: 110, backgroundColor: c.muted }}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{ backgroundColor: c.muted, height: 110, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }}>
                    <Text style={{ fontFamily: fonts.display, fontSize: 20, color: c.foreground, textAlign: "center" }} numberOfLines={1}>
                      {item.first_name || (hi ? "गैलरी" : "Gallery")}
                    </Text>
                  </View>
                )}
                <View style={{ padding: 12, gap: 6 }}>
                  {item.is_featured ? <Pill tone="warning" label={hi ? "विशेष" : "Featured"} /> : null}
                  {item.first_name ? <Body style={{ fontSize: 13, fontFamily: fonts.display }}>{item.first_name}</Body> : null}
                  {caption ? <Body style={{ fontSize: 13 }} numberOfLines={2}>{caption}</Body> : null}
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
