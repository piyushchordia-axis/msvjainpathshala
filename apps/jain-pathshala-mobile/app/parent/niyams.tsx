import { View } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useNiyamCatalog, useStudentNiyams } from "@/lib/queries";
import { dateRangeLabel, endsInDaysLabel } from "@/lib/niyam-badges";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { NiyamListRow } from "@/components/NiyamListRow";
import { NiyamBadgeRow } from "@/components/NiyamBadgeRow";
import { NiyamSubmissionsList } from "@/components/NiyamSubmissionsList";
import { Body, Button, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function ParentNiyams() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const niyams = useStudentNiyams(activeStudentId ?? undefined);
  const catalog = useNiyamCatalog(!!activeStudentId, activeStudentId);
  const items = niyams.data?.items ?? [];
  const catalogRows = catalog.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "नियम" : "Niyams"}
        subtitle={hi ? "आपके बच्चे के संकल्प" : "Your child's submissions"}
      />
      <Screen
        refreshing={niyams.isRefetching || catalog.isRefetching}
        onRefresh={() => {
          refetch();
          niyams.refetch();
          catalog.refetch();
        }}
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
                label={hi ? "नियम प्रस्तुत करें" : "Submit Niyam"}
                icon="sparkles-outline"
                variant="primary"
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
              <NiyamSubmissionsList items={items} hi={hi} preview />
            )}

            <Title style={{ fontSize: 17, marginTop: 14, marginBottom: 4 }}>
              {hi ? "नियम सूची" : "Niyam catalog"}
            </Title>
            <Body muted style={{ fontSize: 12, marginBottom: 8 }}>
              {hi
                ? "लकीर बैज और समाप्ति तिथि नीचे दिखती है।"
                : "Streak badges and end dates appear below each Niyam."}
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
              <View style={{ gap: 10 }}>
                {catalogRows.map((row) => {
                  const title = hi ? row.title_hi : row.title_en;
                  const submitted = !!row.submitted_this_period;
                  const tag = hi ? row.period_status_tag_hi : row.period_status_tag_en;
                  const period = hi ? row.period_label_hi : row.period_label_en;
                  const range = dateRangeLabel(row.start_date, row.end_date, hi);
                  const ends = endsInDaysLabel(row.end_date, hi);
                  const meta = [row.niyam_type, period, range, submitted ? tag : null]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <View key={row.id}>
                      <NiyamListRow
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
                      {ends ? (
                        <View style={{ marginTop: 6, marginLeft: 8 }}>
                          <Pill label={ends} tone="warning" />
                        </View>
                      ) : null}
                      <NiyamBadgeRow
                        niyamType={row.niyam_type}
                        earnedBadges={row.earned_badges}
                        hi={hi}
                      />
                    </View>
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
