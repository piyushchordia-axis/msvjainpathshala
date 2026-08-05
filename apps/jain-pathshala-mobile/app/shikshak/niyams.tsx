import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useNiyamCatalog } from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function NiyamsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useNiyamCatalog();
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "नियम सूची" : "Niyam catalog"} />
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "नियम लोड नहीं हुए।" : "Could not load niyams."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "कोई नियम नहीं मिला।" : "No niyams found."} />
        ) : (
          items.map((n) => {
            const title = hi ? n.title_hi ?? n.title_en : n.title_en;
            const desc = hi ? n.description_hi ?? n.description_en : n.description_en;
            return (
              <Card key={n.id}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Title style={{ fontSize: 17 }}>{title}</Title>
                  </View>
                  <Pill tone="primary" label={`${n.points} ${hi ? "अंक" : "pts"}`} />
                </Row>
                <Row style={{ marginTop: 8 }}>
                  <Pill tone="info" label={n.niyam_type} />
                </Row>
                {desc ? <Body muted style={{ marginTop: 10 }}>{desc}</Body> : null}
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}
