import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useShivirs } from "@/lib/queries";
import { formatDateRange } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Row, Screen, StateView, Title } from "@/components/ui";

function truncate(text: string, n: number) {
  return text.length > n ? `${text.slice(0, n).trim()}…` : text;
}

export default function GuestShivirsScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();

  const { data, isLoading, isError, refetch, isRefetching } = useShivirs();
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "शिविर" : "Shivirs & camps"}
        subtitle={hi ? "नेटवर्क भर में शिविर और रिट्रीट" : "Camps and retreats across the network"}
      />
      <Screen refreshing={isRefetching} onRefresh={refetch} contentStyle={{ paddingBottom: 110 }}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "शिविर लोड नहीं हो सके।" : "Could not load shivirs."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "अभी कोई आगामी शिविर नहीं है।" : "No upcoming shivirs right now."} />
        ) : (
          items.map((shivir) => (
            <Pressable key={shivir.id} onPress={() => router.push(`/shivir/${shivir.id}`)}>
              {({ pressed }) => (
                <Card style={{ opacity: pressed ? 0.85 : 1 }}>
                  <Title style={{ fontSize: 19 }}>{shivir.name}</Title>
                  {shivir.description ? (
                    <Body muted style={{ marginTop: 6 }}>{truncate(shivir.description, 120)}</Body>
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
          ))
        )}
      </Screen>
    </View>
  );
}
