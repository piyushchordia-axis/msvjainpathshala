import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminBatches } from "@/lib/queries";
import { formatTimeRange } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_HI = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];

export default function BatchesScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminBatches();
  const items = data?.items ?? [];

  const days = (input: number[]) =>
    input
      .map((d) => (hi ? DAYS_HI[d] : DAYS_EN[d]))
      .filter(Boolean)
      .join(", ");

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "मेरे बैच" : "My batches"} />
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "बैच लोड नहीं हुए।" : "Could not load batches."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "कोई बैच नहीं मिला।" : "No batches found."} />
        ) : (
          items.map((b) => (
            <Card key={b.id}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Title style={{ fontSize: 17 }}>{b.name ?? (hi ? "बैच" : "Batch")}</Title>
                  <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                    {[b.centre_name, b.age_group].filter(Boolean).join(" · ") || "—"}
                  </Body>
                </View>
                <Pill tone={b.status === "active" ? "success" : "neutral"} label={b.status} />
              </Row>
              {b.shikshak_name ? (
                <Body muted style={{ fontSize: 13, marginTop: 8 }}>{b.shikshak_name}</Body>
              ) : null}
              <Body muted style={{ fontSize: 13, marginTop: 6 }}>
                {[days(b.day_of_week), formatTimeRange(b.start_time, b.end_time)]
                  .filter(Boolean)
                  .join(" · ")}
              </Body>
            </Card>
          ))
        )}
      </Screen>
    </View>
  );
}
