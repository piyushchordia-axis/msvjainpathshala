import { View } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useStudentNiyams } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { NiyamListRow } from "@/components/NiyamListRow";
import { Body, Button, Row, Screen, StateView, Title } from "@/components/ui";

function statusTone(status: string): "success" | "warning" | "error" | "neutral" | "primary" {
  const s = status.toLowerCase();
  if (s === "approved" || s === "accepted" || s === "auto_approved") return "success";
  if (s === "pending") return "warning";
  if (s === "rejected") return "error";
  if (s === "featured") return "primary";
  return "neutral";
}

function statusLabel(status: string, hi: boolean): string {
  const s = status.toLowerCase();
  if (s === "approved" || s === "accepted" || s === "auto_approved") {
    return hi ? "स्वीकृत" : "Approved";
  }
  if (s === "pending") return hi ? "लंबित" : "Pending";
  if (s === "rejected") return hi ? "अस्वीकृत" : "Rejected";
  return status;
}

export default function ParentNiyams() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const niyams = useStudentNiyams(activeStudentId ?? undefined);
  const items = niyams.data?.items ?? [];

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

            <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <Title style={{ fontSize: 17 }}>{hi ? "प्रस्तुतियाँ" : "Submissions"}</Title>
              <Button
                label={hi ? "नियम भेजें" : "Submit"}
                icon="sparkles-outline"
                variant="outline"
                onPress={() => router.push("/niyam-submit")}
              />
            </Row>

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
              <View style={{ gap: 8 }}>
                {items.map((n) => {
                  const title = hi ? n.niyam_title_hi : n.niyam_title_en;
                  const featured = n.is_featured
                    ? hi
                      ? "विशेष"
                      : "Featured"
                    : null;
                  const meta = [
                    n.niyam_type,
                    formatDate(n.submission_date),
                    featured,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <NiyamListRow
                      key={n.id}
                      title={title}
                      meta={meta}
                      points={n.points_awarded}
                      niyamType={n.niyam_type}
                      statusLabel={statusLabel(n.status, hi)}
                      statusTone={statusTone(n.status)}
                      showChevron={false}
                    />
                  );
                })}
              </View>
            )}

            <Body muted style={{ marginTop: 8, fontSize: 12, textAlign: "center" }}>
              {hi
                ? "रंग: दैनिक · साप्ताहिक · मासिक"
                : "Colors mark daily · weekly · monthly"}
            </Body>
          </>
        )}
      </Screen>
    </View>
  );
}
