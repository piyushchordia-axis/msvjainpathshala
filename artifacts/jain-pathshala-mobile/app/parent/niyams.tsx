import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useStudentNiyams } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Card, Kicker, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function ParentNiyams() {
  const c = useColors();
  const { hi } = useLocale();
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const niyams = useStudentNiyams(activeStudentId ?? undefined);
  const items = niyams.data?.items ?? [];

  function statusTone(status: string): "success" | "warning" | "neutral" {
    const s = status.toLowerCase();
    if (s === "approved" || s === "accepted") return "success";
    if (s === "pending") return "warning";
    return "neutral";
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "नियम" : "Niyams"}
        subtitle={hi ? "आपके बच्चे के संकल्प" : "Your child's submissions"}
      />
      <Screen
        refreshing={niyams.isRefetching}
        onRefresh={niyams.refetch}
        contentStyle={{ paddingBottom: 110 }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "जानकारी लोड नहीं हुई।" : "Could not load your children."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : children.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपके खाते से कोई बच्चा जुड़ा नहीं है।"
                : "No children linked to your account yet."
            }
          />
        ) : (
          <>
            <ChildSwitcher />

            {niyams.isLoading ? (
              <StateView status="loading" emptyText="" />
            ) : niyams.isError ? (
              <StateView
                status="error"
                emptyText=""
                errorText={hi ? "नियम लोड नहीं हुए।" : "Could not load niyams."}
                onRetry={niyams.refetch}
                retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
              />
            ) : items.length === 0 ? (
              <StateView
                status="empty"
                emptyText={hi ? "अभी कोई नियम दर्ज नहीं है।" : "No niyams submitted yet."}
              />
            ) : (
              items.map((n) => {
                const title = hi ? n.niyam_title_hi : n.niyam_title_en;
                return (
                  <Card key={n.id}>
                    <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Kicker>{formatDate(n.submission_date)}</Kicker>
                        <Title style={{ fontSize: 17, marginTop: 4 }}>{title}</Title>
                      </View>
                      {n.is_featured ? (
                        <Pill label={hi ? "विशेष" : "Featured"} tone="primary" />
                      ) : null}
                    </Row>
                    <Row style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <Pill label={n.niyam_type} tone="neutral" />
                      <Pill label={n.status} tone={statusTone(n.status)} />
                      <Pill
                        label={hi ? `${n.points_awarded} अंक` : `${n.points_awarded} pts`}
                        tone="info"
                      />
                    </Row>
                  </Card>
                );
              })
            )}
          </>
        )}
      </Screen>
    </View>
  );
}
