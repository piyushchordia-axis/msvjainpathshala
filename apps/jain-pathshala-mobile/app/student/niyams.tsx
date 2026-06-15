import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useNiyamCatalog, useStudentNiyams } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function StudentNiyams() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const submissions = useStudentNiyams(activeStudentId ?? undefined);
  const catalog = useNiyamCatalog(!!activeStudentId);

  const submissionRows = submissions.data?.items ?? [];
  const catalogRows = catalog.data?.items ?? [];

  const statusTone = (status: string): "success" | "warning" | "error" | "neutral" => {
    const s = status.toLowerCase();
    if (s === "approved") return "success";
    if (s === "pending") return "warning";
    if (s === "rejected") return "error";
    return "neutral";
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "नियम" : "Niyams"}
        subtitle={hi ? "आपके संकल्प और नियम सूची" : "Your resolutions and the niyam catalog"}
      />
      <Screen
        refreshing={submissions.isRefetching || catalog.isRefetching}
        onRefresh={() => { refetch(); submissions.refetch(); catalog.refetch(); }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={hi ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।" : "Your student profile isn't ready yet."}
          />
        ) : (
          <>
            <Title style={{ fontSize: 17, marginLeft: 2 }}>{hi ? "मेरे नियम" : "My niyams"}</Title>
            {submissions.isLoading ? (
              <StateView status="loading" emptyText="" />
            ) : submissions.isError ? (
              <StateView
                status="error"
                emptyText=""
                errorText={hi ? "नियम लोड नहीं हुए।" : "Could not load your niyams."}
                onRetry={submissions.refetch}
                retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
              />
            ) : submissionRows.length === 0 ? (
              <StateView status="empty" emptyText={hi ? "अभी कोई नियम प्रस्तुत नहीं किया।" : "No niyams submitted yet."} />
            ) : (
              submissionRows.map((row) => {
                const title = hi ? row.niyam_title_hi : row.niyam_title_en;
                return (
                  <Card key={row.id}>
                    <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Title style={{ fontSize: 16 }}>{title}</Title>
                        <Body muted style={{ fontSize: 12, marginTop: 2 }}>{formatDate(row.submission_date)}</Body>
                      </View>
                      <Pill label={row.status} tone={statusTone(row.status)} />
                    </Row>
                    <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                      <Pill label={row.niyam_type} />
                      <Pill label={`+${row.points_awarded} ${hi ? "पुण्य" : "punya"}`} tone="primary" />
                      {row.is_featured ? <Pill label={hi ? "विशेष" : "Featured"} tone="info" /> : null}
                    </Row>
                  </Card>
                );
              })
            )}

            <Title style={{ fontSize: 17, marginLeft: 2, marginTop: 6 }}>{hi ? "नियम सूची" : "Niyam catalog"}</Title>
            {catalog.isLoading ? (
              <StateView status="loading" emptyText="" />
            ) : catalog.isError ? (
              <StateView
                status="error"
                emptyText=""
                errorText={hi ? "नियम सूची लोड नहीं हुई।" : "Could not load the niyam catalog."}
                onRetry={catalog.refetch}
                retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
              />
            ) : catalogRows.length === 0 ? (
              <StateView status="empty" emptyText={hi ? "अभी कोई नियम उपलब्ध नहीं है।" : "No niyams available yet."} />
            ) : (
              catalogRows.map((row) => {
                const title = hi ? row.title_hi : row.title_en;
                const desc = hi ? row.description_hi : row.description_en;
                return (
                  <Card key={row.id}>
                    <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Title style={{ fontSize: 16 }}>{title}</Title>
                      </View>
                      <Pill label={`+${row.points}`} tone="primary" />
                    </Row>
                    {desc ? <Body muted style={{ marginTop: 8 }}>{desc}</Body> : null}
                    <Row style={{ marginTop: 10 }}>
                      <Pill label={row.niyam_type} />
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
