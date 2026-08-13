import { FlatList, Platform, RefreshControl, View, Text, type ListRenderItem } from "react-native";
import { Image } from "expo-image";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { resolveUploadUrl } from "@/lib/api";
import { useWallGallery, type GalleryMediaItem } from "@/lib/queries";
import { formatAgeGroup } from "@workspace/api-zod";
import { Body, Card, Pill, Screen, StateView, Title } from "@/components/ui";

const COLS = 2;
const CELL_GAP = 12;

/**
 * Punya Wall — curated `featured_gallery` moments.
 * Consent is enforced server-side; featuring never overrides opt-out.
 */
export default function GalleryScreen() {
  const c = useColors();
  const { hi } = useLocale();

  // `enabled` is available for staff shells that pair an admin wall query (PERF #24);
  // this screen only mounts the parent wall fetch.
  const { data, isLoading, isError, refetch, isRefetching } = useWallGallery(60, true);
  const items = data?.items ?? [];

  const renderItem: ListRenderItem<GalleryMediaItem> = ({ item }) => {
    const niyam = hi && item.niyam_title_hi ? item.niyam_title_hi : item.niyam_title_en;
    const caption = (hi ? item.caption_hi : item.caption) || item.caption || niyam;
    // Never fall back to full image_url in a thumbnail cell (PERF #24).
    const uri = resolveUploadUrl(item.thumbnail_url ?? null);
    return (
      <Card style={{ flex: 1, marginHorizontal: CELL_GAP / 2, padding: 0, overflow: "hidden" }}>
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: "100%", height: 110, backgroundColor: c.muted }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={item.id}
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
              {(item.first_name || (hi ? "गैलरी" : "Gallery")).slice(0, 1).toUpperCase()}
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
  };

  const listHeader = (
    <View style={{ marginBottom: 12 }}>
      <Title style={{ fontSize: 22 }}>{hi ? "हमारे बच्चों का पुण्य" : "Punya from our children"}</Title>
    </View>
  );

  return (
    <ActivityThemed accent="punya">
    <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0 }}>
      {isLoading ? (
        <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
          {listHeader}
          <StateView status="loading" emptyText="" />
        </View>
      ) : isError ? (
        <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
          {listHeader}
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "लोड नहीं हो सका।" : "Could not load the gallery."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={COLS}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <StateView
              status="empty"
              emptyText={
                hi
                  ? "नए पल जल्द यहाँ दिखेंगे।"
                  : "New moments will appear here soon."
              }
            />
          }
          columnWrapperStyle={{ marginBottom: CELL_GAP }}
          contentContainerStyle={{
            paddingHorizontal: 18 - CELL_GAP / 2,
            paddingTop: 8,
            paddingBottom: 40,
          }}
          refreshControl={
            <RefreshControl
              refreshing={!!isRefetching}
              onRefresh={refetch}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== "web"}
        />
      )}
    </Screen>
    </ActivityThemed>
  );
}
