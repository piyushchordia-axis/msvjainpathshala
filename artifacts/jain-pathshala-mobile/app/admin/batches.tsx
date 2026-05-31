import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { Alert, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessAdminPanel } from "@/lib/auth";
import { apiGet, apiPost } from "@/lib/api";
import type { AdminBatch, ListResponse } from "@/lib/types";
import { formatTimeRange } from "@/lib/format";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function BatchesScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user, loading } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["admin-batches"],
    queryFn: () => apiGet<ListResponse<AdminBatch>>("/v1/admin/batches"),
    enabled: !!user && canAccessAdminPanel(user.role),
  });

  const mutate = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "deactivate" }) =>
      apiPost(`/v1/admin/batches/${id}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-batches"] }),
    onError: (e) => Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed"),
  });

  if (loading) return <Screen scroll={false}><StateView status="loading" emptyText="" /></Screen>;
  if (!user || !canAccessAdminPanel(user.role)) return <Redirect href="/admin/login" />;

  const items = data?.items ?? [];

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      <Body muted>{hi ? "आपके केंद्रों के बैच" : "Batches across your centres"}</Body>
      {isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : isError ? (
        <StateView status="error" emptyText="" errorText={hi ? "बैच लोड नहीं हुए।" : "Could not load batches."} onRetry={refetch} retryLabel={hi ? "पुनः प्रयास करें" : "Try again"} />
      ) : items.length === 0 ? (
        <StateView status="empty" emptyText={hi ? "कोई बैच नहीं मिला।" : "No batches found."} />
      ) : (
        items.map((b) => {
          const active = b.status === "active";
          return (
            <Card key={b.id}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Title style={{ fontSize: 17 }}>{b.name}</Title>
                  <Body muted style={{ fontSize: 12, marginTop: 2 }}>{[b.centre_name, b.age_group].filter(Boolean).join(" · ") || "—"}</Body>
                </View>
                <Pill tone={active ? "success" : "neutral"} label={b.status} />
              </Row>
              <Body muted style={{ fontSize: 13, marginTop: 8 }}>
                {[b.shikshak_name, b.day_of_week, formatTimeRange(b.start_time, b.end_time)].filter(Boolean).join(" · ")}
              </Body>
              <Button
                label={active ? (hi ? "निष्क्रिय करें" : "Deactivate") : (hi ? "सक्रिय करें" : "Activate")}
                variant={active ? "outline" : "secondary"}
                onPress={() => mutate.mutate({ id: b.id, action: active ? "deactivate" : "activate" })}
                loading={mutate.isPending && mutate.variables?.id === b.id}
                style={{ marginTop: 12 }}
              />
            </Card>
          );
        })
      )}
    </Screen>
  );
}
