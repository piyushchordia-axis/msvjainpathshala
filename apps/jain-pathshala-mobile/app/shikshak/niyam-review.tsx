/**
 * Shikshak Niyam review — approve / reject pending submissions in scope.
 */
import { useState } from "react";
import { Alert, Linking, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

type PendingNiyam = {
  id: string;
  student_name: string;
  student_code: string;
  niyam_title_en: string;
  niyam_title_hi: string | null;
  proof_url: string | null;
  notes: string | null;
  submission_date: string;
  status: string;
  media?: Array<{ id: string; url: string; kind: string }>;
};

function usePendingNiyams() {
  return useQuery({
    queryKey: ["shikshak", "niyam-pending"],
    queryFn: () => apiGet<{ items: PendingNiyam[] }>("/v1/niyam-submissions/pending?limit=100"),
  });
}

export default function NiyamReviewScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const qc = useQueryClient();
  const list = usePendingNiyams();
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: "approve" | "reject";
      reason?: string;
    }) =>
      apiPost(
        `/v1/niyam-submissions/${id}/${action}`,
        action === "reject"
          ? {
              reason:
                reason ??
                "Does not meet the Niyam requirements — please resubmit with clearer proof.",
            }
          : {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shikshak", "niyam-pending"] });
    },
  });

  function onDecide(id: string, action: "approve" | "reject") {
    const title =
      action === "approve"
        ? hi
          ? "स्वीकृत करें?"
          : "Approve this Niyam?"
        : hi
          ? "अस्वीकृत करें?"
          : "Reject this Niyam?";
    const message =
      action === "reject"
        ? hi
          ? "विद्यार्थी को पुनः प्रस्तुत करने के लिए कहा जाएगा।"
          : "The student will be asked to submit again."
        : undefined;
    Alert.alert(title, message, [
      { text: hi ? "रद्द" : "Cancel", style: "cancel" },
      {
        text: action === "approve" ? (hi ? "स्वीकृत" : "Approve") : hi ? "अस्वीकृत" : "Reject",
        style: action === "reject" ? "destructive" : "default",
        onPress: () => {
          setBusyId(id);
          decide.mutate(
            { id, action },
            {
              onError: (e) => {
                Alert.alert(
                  hi ? "त्रुटि" : "Could not update",
                  e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
                );
              },
              onSettled: () => setBusyId(null),
            },
          );
        },
      },
    ]);
  }

  const items = list.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "नियम समीक्षा" : "Niyam review"}
        subtitle={hi ? "लंबित प्रस्तुतियों की जाँच करें" : "Review pending submissions"}
      />
      <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
        {list.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : list.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "नियम लोड नहीं हुए।" : "Could not load submissions."}
            onRetry={list.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "कोई लंबित नियम नहीं।" : "No pending Niyams to review."}
          />
        ) : (
          items.map((row) => {
            const title = hi ? row.niyam_title_hi || row.niyam_title_en : row.niyam_title_en;
            const proof =
              row.proof_url ??
              row.media?.find((m) => m.url)?.url ??
              null;
            const busy = busyId === row.id;
            return (
              <Card key={row.id}>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Title style={{ fontSize: 16 }}>{title}</Title>
                    <Body muted style={{ fontSize: 12, marginTop: 4 }}>
                      {row.student_name} · {row.student_code}
                    </Body>
                    <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                      {formatDate(row.submission_date)}
                    </Body>
                  </View>
                  <Pill tone="warning" label={hi ? "लंबित" : "Pending"} />
                </Row>
                {row.notes ? (
                  <Body style={{ marginTop: 10, fontSize: 13 }}>{row.notes}</Body>
                ) : null}
                {proof ? (
                  <Button
                    label={hi ? "प्रमाण देखें" : "Open proof"}
                    variant="ghost"
                    icon="link-outline"
                    style={{ marginTop: 8 }}
                    onPress={() => {
                      void Linking.openURL(proof).catch(() => {
                        Alert.alert(
                          hi ? "खोल नहीं सके" : "Could not open",
                          hi ? "लिंक काम नहीं कर रहा।" : "That link could not be opened.",
                        );
                      });
                    }}
                  />
                ) : null}
                <Row style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <Button
                    label={hi ? "स्वीकृत" : "Approve"}
                    variant="secondary"
                    disabled={busy}
                    loading={busy && decide.variables?.action === "approve"}
                    onPress={() => onDecide(row.id, "approve")}
                    style={{ paddingVertical: 10, paddingHorizontal: 14 } as never}
                  />
                  <Button
                    label={hi ? "अस्वीकृत" : "Reject"}
                    variant="outline"
                    disabled={busy}
                    loading={busy && decide.variables?.action === "reject"}
                    onPress={() => onDecide(row.id, "reject")}
                    style={{ paddingVertical: 10, paddingHorizontal: 14 } as never}
                  />
                </Row>
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}
