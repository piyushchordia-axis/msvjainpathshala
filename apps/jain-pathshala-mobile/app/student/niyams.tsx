import { View } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useNiyamCatalog, useStudentNiyams } from "@/lib/queries";
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

export default function StudentNiyams() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const submissions = useStudentNiyams(activeStudentId ?? undefined);
  const catalog = useNiyamCatalog(!!activeStudentId, activeStudentId);

  const submissionRows = submissions.data?.items ?? [];
  const catalogRows = catalog.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "नियम" : "Niyams"}
        subtitle={hi ? "आपके संकल्प और नियम सूची" : "Your resolutions and the niyam catalog"}
      />
      <Screen
        refreshing={submissions.isRefetching || catalog.isRefetching}
        onRefresh={() => {
          refetch();
          submissions.refetch();
          catalog.refetch();
        }}
        contentStyle={{ paddingBottom: 110 }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।"
                : "Your student profile isn't ready yet."
            }
          />
        ) : (
          <>
            <ChildSwitcher />

            <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <Title style={{ fontSize: 17 }}>{hi ? "मेरे नियम" : "My niyams"}</Title>
              <Button
                label={hi ? "नियम भेजें" : "Submit"}
                icon="sparkles-outline"
                variant="outline"
                onPress={() => router.push("/niyam-submit")}
              />
            </Row>

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
              <StateView
                status="empty"
                emptyText={hi ? "अभी कोई नियम प्रस्तुत नहीं किया।" : "No niyams submitted yet."}
              />
            ) : (
              <View style={{ gap: 8 }}>
                {submissionRows.map((row) => {
                  const title = hi ? row.niyam_title_hi : row.niyam_title_en;
                  const featured = row.is_featured ? (hi ? "विशेष" : "Featured") : null;
                  const meta = [row.niyam_type, formatDate(row.submission_date), featured]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <NiyamListRow
                      key={row.id}
                      title={title}
                      meta={meta}
                      points={row.points_awarded}
                      niyamType={row.niyam_type}
                      statusLabel={statusLabel(row.status, hi)}
                      statusTone={statusTone(row.status)}
                      showChevron={false}
                    />
                  );
                })}
              </View>
            )}

            <Title style={{ fontSize: 17, marginTop: 10, marginBottom: 4 }}>
              {hi ? "नियम सूची" : "Niyam catalog"}
            </Title>
            <Body muted style={{ fontSize: 12, marginBottom: 8 }}>
              {hi
                ? "नियम चुनें और प्रस्तुत करें — रंग: दैनिक · साप्ताहिक · मासिक"
                : "Tap a niyam to submit — colors mark daily · weekly · monthly"}
            </Body>

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
              <StateView
                status="empty"
                emptyText={hi ? "अभी कोई नियम उपलब्ध नहीं है।" : "No niyams available yet."}
              />
            ) : (
              <View style={{ gap: 8 }}>
                {catalogRows.map((row) => {
                  const title = hi ? row.title_hi : row.title_en;
                  const submitted = !!row.submitted_this_period;
                  const tag = hi ? row.period_status_tag_hi : row.period_status_tag_en;
                  const period = hi ? row.period_label_hi : row.period_label_en;
                  const meta = [row.niyam_type, period, submitted ? tag : null]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <NiyamListRow
                      key={row.id}
                      title={title}
                      meta={meta}
                      points={row.points}
                      niyamType={row.niyam_type}
                      emphasizedMeta={submitted}
                      statusLabel={
                        submitted
                          ? (tag ?? (hi ? "प्रस्तुत" : "Submitted"))
                          : null
                      }
                      statusTone={submitted ? "primary" : "neutral"}
                      onPress={() => router.push("/niyam-submit")}
                    />
                  );
                })}
              </View>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}
