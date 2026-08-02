import { Image, View, Text } from "react-native";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { resolveUploadUrl } from "@/lib/api";
import { useWallGallery } from "@/lib/queries";
import { formatAgeGroup } from "@workspace/api-zod";
import { Body, Card, Pill, Screen, StateView, Title } from "@/components/ui";

/**
 * Punya Wall — curated `featured_gallery` moments.
 * Consent is enforced server-side; featuring never overrides opt-out.
 */
export default function GalleryScreen() {
  const c = useColors();
  const { hi } = useLocale();

  const { data, isLoading, isError, refetch, isRefetching } = useWallGallery(60);
  const items = data?.items ?? [];

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      <Title style={{ fontSize: 22 }}>{hi ? "हमारे बच्चों का पुण्य" : "Punya from our children"}</Title>
      {isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : isError ? (
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "लोड नहीं हो सका।" : "Could not load the gallery."}
          onRetry={refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      ) : items.length === 0 ? (
        <StateView
          status="empty"
          emptyText={
            hi
              ? "नए पल जल्द यहाँ दिखेंगे।"
              : "New moments will appear here soon."
          }
        />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {items.map((item) => {
            const niyam = hi && item.niyam_title_hi ? item.niyam_title_hi : item.niyam_title_en;
            const caption = (hi ? item.caption_hi : item.caption) || item.caption || niyam;
            const uri = resolveUploadUrl(item.thumbnail_url ?? item.image_url ?? null);
            return (
              <Card key={item.id} style={{ width: "47%", padding: 0, overflow: "hidden" }}>
                {uri ? (
                  <Image
                    source={{ uri }}
                    style={{ width: "100%", height: 110, backgroundColor: c.muted }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      backgroundColor: c.muted,
                      height: 110,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 8,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.display,
                        fontSize: 20,
                        color: c.foreground,
                        textAlign: "center",
                      }}
                      numberOfLines={1}
                    >
                      {item.first_name || (hi ? "गैलरी" : "Gallery")}
                    </Text>
                  </View>
                )}
                <View style={{ padding: 12, gap: 6 }}>
                  {item.is_featured ? <Pill tone="warning" label={hi ? "विशेष" : "Featured"} /> : null}
                  {item.first_name ? (
                    <Body style={{ fontSize: 13, fontFamily: fonts.display }}>{item.first_name}</Body>
                  ) : null}
                  {caption ? (
                    <Body style={{ fontSize: 13 }} numberOfLines={2}>
                      {caption}
                    </Body>
                  ) : null}
                  {item.age_group ? (
                    <Body muted style={{ fontSize: 12 }}>
                      {formatAgeGroup(item.age_group, hi ? "hi" : "en")}
                    </Body>
                  ) : null}
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
