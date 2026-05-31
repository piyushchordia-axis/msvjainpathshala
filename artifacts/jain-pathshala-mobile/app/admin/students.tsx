import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { Alert, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessAdminPanel } from "@/lib/auth";
import { apiGet, apiPost } from "@/lib/api";
import type { AdminStudent, ListResponse } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function StudentsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user, loading } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["admin-students"],
    queryFn: () => apiGet<ListResponse<AdminStudent>>("/v1/admin/students?limit=100"),
    enabled: !!user && canAccessAdminPanel(user.role),
  });

  const mutate = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "deactivate" | "reactivate" }) =>
      apiPost(`/v1/admin/students/${id}/status`, { action, reason: "Updated via mobile admin" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-students"] }),
    onError: (e) => Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed"),
  });

  if (loading) return <Screen scroll={false}><StateView status="loading" emptyText="" /></Screen>;
  if (!user || !canAccessAdminPanel(user.role)) return <Redirect href="/admin/login" />;

  const items = data?.items ?? [];

  const confirm = (s: AdminStudent) => {
    const deactivate = s.status === "active";
    Alert.alert(
      deactivate ? (hi ? "निष्क्रिय करें?" : "Deactivate?") : (hi ? "पुनः सक्रिय करें?" : "Reactivate?"),
      s.full_name,
      [
        { text: hi ? "रद्द" : "Cancel", style: "cancel" },
        { text: hi ? "पुष्टि" : "Confirm", style: deactivate ? "destructive" : "default", onPress: () => mutate.mutate({ id: s.id, action: deactivate ? "deactivate" : "reactivate" }) },
      ],
    );
  };

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      <Body muted>{hi ? "आपके केंद्रों की सूची" : "Roster across your centres"}</Body>
      {isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : isError ? (
        <StateView status="error" emptyText="" errorText={hi ? "विद्यार्थी लोड नहीं हुए।" : "Could not load students."} onRetry={refetch} retryLabel={hi ? "पुनः प्रयास करें" : "Try again"} />
      ) : items.length === 0 ? (
        <StateView status="empty" emptyText={hi ? "कोई विद्यार्थी नहीं मिला।" : "No students found."} />
      ) : (
        items.map((s) => (
          <Card key={s.id}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Title style={{ fontSize: 17 }}>{s.full_name}</Title>
                <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                  {[s.student_code, s.age_group].filter(Boolean).join(" · ") || "—"}
                </Body>
              </View>
              <Pill tone={s.status === "active" ? "success" : "neutral"} label={s.status} />
            </Row>
            <Row style={{ gap: 8, marginTop: 8 }}>
              {s.dob ? <Body muted style={{ fontSize: 12 }}>{hi ? "जन्म" : "DOB"}: {formatDate(s.dob)}</Body> : null}
              {s.msv_status ? <Pill label={`MSV: ${s.msv_status}`} /> : null}
            </Row>
            <Button
              label={s.status === "active" ? (hi ? "निष्क्रिय करें" : "Deactivate") : (hi ? "पुनः सक्रिय करें" : "Reactivate")}
              variant={s.status === "active" ? "outline" : "secondary"}
              onPress={() => confirm(s)}
              loading={mutate.isPending && mutate.variables?.id === s.id}
              style={{ marginTop: 12 }}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}
