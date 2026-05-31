import { Ionicons } from "@expo/vector-icons";
import { Linking, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useLibrary } from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  pdf: "document-text-outline",
  video: "play-circle-outline",
  audio: "musical-notes-outline",
  image: "image-outline",
};

/**
 * Shared digital-library screen used by the guest, parent and student groups.
 * Reads the public library endpoint and renders branded resource cards.
 */
export function LibraryView() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useLibrary();
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "पुस्तकालय" : "Digital library"}
        subtitle={hi ? "ग्रंथ, वीडियो और श्रव्य सामग्री" : "Scriptures, videos and audio resources"}
      />
      <Screen refreshing={isRefetching} onRefresh={refetch} contentStyle={{ paddingBottom: 110 }}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "पुस्तकालय लोड नहीं हुआ।" : "Could not load the library."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
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
                  <Button
                    label={hi ? "खोलें" : "Open"}
                    icon="open-outline"
                    variant="outline"
                    onPress={() => Linking.openURL(item.embed_url!)}
                    style={{ marginTop: 12 }}
                  />
                ) : null}
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}
