import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessAdminPanel } from "@/lib/auth";
import { apiGet, apiPost } from "@/lib/api";
import type { AdminEnrolment, ListResponse } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

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
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["admin-enrolments", filter],
    queryFn: () => apiGet<ListResponse<AdminEnrolment>>(`/v1/admin/enrolments${filter ? `?status=${filter}` : ""}`),
    enabled: !!user && canAccessAdminPanel(user.role),
  });

  const mutate = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "waitlist" | "reject" }) =>
      apiPost(`/v1/admin/enrolments/${id}/${action}`, action === "reject" ? { reason: "Rejected via mobile admin" } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-enrolments"] }),
    onError: (e) => Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed"),
  });

  if (loading) return <Screen scroll={false}><StateView status="loading" emptyText="" /></Screen>;
  if (!user || !canAccessAdminPanel(user.role)) return <Redirect href="/admin/login" />;

  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 12, gap: 8 }} style={{ flexGrow: 0 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable key={f.key || "all"} onPress={() => setFilter(f.key)} style={{ backgroundColor: active ? c.primary : c.muted, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: active ? c.primaryForeground : c.mutedForeground }}>{hi ? f.hi : f.en}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Screen contentStyle={{ paddingTop: 0 }} refreshing={isRefetching} onRefresh={refetch}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView status="error" emptyText="" errorText={hi ? "नामांकन लोड नहीं हुए।" : "Could not load enrolments."} onRetry={refetch} retryLabel={hi ? "पुनः प्रयास करें" : "Try again"} />
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
                {e.decided_at ? <Body muted style={{ fontSize: 12, marginTop: 4 }}>{hi ? "निर्णय" : "Decided"}: {formatDate(e.decided_at)}</Body> : null}
                {actionable ? (
                  <Row style={{ gap: 8, marginTop: 12 }}>
                    <Button label={hi ? "स्वीकृत" : "Approve"} onPress={() => mutate.mutate({ id: e.id, action: "approve" })} style={{ flex: 1 }} loading={mutate.isPending && mutate.variables?.id === e.id} />
                    <Button label={hi ? "प्रतीक्षा" : "Waitlist"} variant="secondary" onPress={() => mutate.mutate({ id: e.id, action: "waitlist" })} style={{ flex: 1 }} />
                    <Button label={hi ? "अस्वीकृत" : "Reject"} variant="outline" onPress={() => mutate.mutate({ id: e.id, action: "reject" })} style={{ flex: 1 }} />
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
