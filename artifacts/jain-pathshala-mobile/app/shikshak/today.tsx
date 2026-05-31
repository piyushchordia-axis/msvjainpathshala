import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useToday } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function TodayScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useToday();
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "आज के सत्र" : "Today's sessions"} />
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "सत्र लोड नहीं हुए।" : "Could not load sessions."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "आज कोई सत्र नहीं है।" : "No sessions today."} />
        ) : (
          items.map((s) => (
            <Card key={s.id}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Title style={{ fontSize: 17 }}>{s.batch_name ?? (hi ? "बैच" : "Batch")}</Title>
                  {s.centre_name ? (
                    <Body muted style={{ fontSize: 12, marginTop: 2 }}>{s.centre_name}</Body>
                  ) : null}
                </View>
                <Pill label={s.status} />
              </Row>
              <Body muted style={{ fontSize: 13, marginTop: 8 }}>{formatDate(s.session_date)}</Body>
              {s.topic ? <Body style={{ marginTop: 6 }}>{s.topic}</Body> : null}
              <Row style={{ marginTop: 10 }}>
                <Pill
                  tone="info"
                  label={
                    hi
                      ? `${s.present_count}/${s.total_count} उपस्थित`
                      : `${s.present_count}/${s.total_count} present`
                  }
                />
              </Row>
            </Card>
          ))
        )}
      </Screen>
    </View>
  );
}
