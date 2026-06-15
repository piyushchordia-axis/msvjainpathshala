import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminEnrolments, useEnrolmentAction } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView } from "@/components/ui";

const FILTERS = [
  { key: "", en: "All", hi: "सभी" },
  { key: "pending", en: "Pending", hi: "लंबित" },
  { key: "waitlisted", en: "Waitlisted", hi: "प्रतीक्षा" },
  { key: "approved", en: "Approved", hi: "स्वीकृत" },
  { key: "rejected", en: "Rejected", hi: "अस्वीकृत" },
];

function tone(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "approved") return "success";
  if (status === "waitlisted" || status === "pending") return "warning";
  if (status === "rejected") return "error";
  return "neutral";
}

export default function EnrolmentsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const [filter, setFilter] = useState("");
  const { data, isLoading, isError, refetch, isRefetching } = useAdminEnrolments(filter || undefined);
  const mutate = useEnrolmentAction();

  const items = data?.items ?? [];

  const run = (id: string, action: "approve" | "waitlist" | "reject") =>
    mutate.mutate(
      { id, action, reason: action === "reject" ? "Rejected via mobile admin" : undefined },
      { onError: (e) => Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed") },
    );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "नामांकन" : "Enrolments"}
        subtitle={hi ? "नामांकन अनुरोधों की समीक्षा करें" : "Review enrolment requests"}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 12, gap: 8 }}
        style={{ flexGrow: 0 }}
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key || "all"}
              onPress={() => setFilter(f.key)}
              style={{ backgroundColor: active ? c.primary : c.muted, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}
            >
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: active ? c.primaryForeground : c.mutedForeground }}>
                {hi ? f.hi : f.en}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Screen contentStyle={{ paddingTop: 0 }} refreshing={isRefetching} onRefresh={refetch}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "नामांकन लोड नहीं हुए।" : "Could not load enrolments."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "कोई नामांकन नहीं।" : "No enrolments here."} />
        ) : (
          items.map((e) => {
            const actionable = e.status === "pending" || e.status === "waitlisted";
            return (
              <Card key={e.id}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Body muted style={{ fontSize: 12 }}>{hi ? "जमा" : "Submitted"}: {formatDate(e.created_at)}</Body>
                  <Pill tone={tone(e.status)} label={e.status} />
                </Row>
                {e.decided_at ? (
                  <Body muted style={{ fontSize: 12, marginTop: 4 }}>{hi ? "निर्णय" : "Decided"}: {formatDate(e.decided_at)}</Body>
                ) : null}
                {actionable ? (
                  <Row style={{ gap: 8, marginTop: 12 }}>
                    <Button
                      label={hi ? "स्वीकृत" : "Approve"}
                      onPress={() => run(e.id, "approve")}
                      style={{ flex: 1 }}
                      loading={mutate.isPending && mutate.variables?.id === e.id}
                    />
                    <Button label={hi ? "प्रतीक्षा" : "Waitlist"} variant="secondary" onPress={() => run(e.id, "waitlist")} style={{ flex: 1 }} />
                    <Button label={hi ? "अस्वीकृत" : "Reject"} variant="outline" onPress={() => run(e.id, "reject")} style={{ flex: 1 }} />
                  </Row>
                ) : null}
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}
