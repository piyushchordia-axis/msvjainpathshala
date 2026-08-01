import { Alert, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminBatches, useBatchAction } from "@/lib/queries";
import { formatTimeRange } from "@/lib/format";
import { formatAgeGroups } from "@workspace/api-zod";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

// ISO weekday: 1=Mon … 7=Sun (index 0 unused) — matches the API/web convention.
const DAYS_EN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_HI = ["", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"];

export default function BatchesScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminBatches();
  const mutate = useBatchAction();

  const items = data?.items ?? [];

  const formatDays = (days: number[]) =>
    days.map((d) => (hi ? DAYS_HI[d] : DAYS_EN[d]) ?? "").filter(Boolean).join(", ");

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "बैच" : "Batches"}
        subtitle={hi ? "आपके केंद्रों के बैच" : "Batches across your centres"}
      />
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
          items.map((b) => {
            const active = b.status === "active";
            const schedule = [b.shikshak_name, formatDays(b.day_of_week), formatTimeRange(b.start_time, b.end_time)]
              .filter(Boolean)
              .join(" · ");
            return (
              <Card key={b.id}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Title style={{ fontSize: 17 }}>{b.name ?? "—"}</Title>
                    <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                      {[b.centre_name, formatAgeGroups(b.age_groups, hi ? "hi" : "en")].filter(Boolean).join(" · ") || "—"}
                    </Body>
                  </View>
                  <Pill tone={active ? "success" : "neutral"} label={b.status} />
                </Row>
                {schedule ? <Body muted style={{ fontSize: 13, marginTop: 8 }}>{schedule}</Body> : null}
                <Button
                  label={active ? (hi ? "निष्क्रिय करें" : "Deactivate") : (hi ? "सक्रिय करें" : "Activate")}
                  variant={active ? "outline" : "secondary"}
                  onPress={() =>
                    mutate.mutate(
                      { id: b.id, action: active ? "deactivate" : "activate" },
                      { onError: (e) => Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed") },
                    )
                  }
                  loading={mutate.isPending && mutate.variables?.id === b.id}
                  style={{ marginTop: 12 }}
                />
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}
