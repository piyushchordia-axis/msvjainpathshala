import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

/* Shapes mirror /v1/service-requests/:id exactly (snake_case). */
type RequestStatus = "submitted" | "in_review" | "resolved";

interface ThreadMessage {
  id: string;
  message: string;
  author_user_id: string | null;
  author_name: string | null;
  created_at: string;
}

interface RequestDetail {
  id: string;
  category: string;
  subject: string;
  description: string;
  status: RequestStatus;
  parent_name: string | null;
  student_name: string | null;
  centre_name: string | null;
  assigned_to: string | null;
  last_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  messages: ThreadMessage[];
}

type Tone = "success" | "warning" | "info";

function statusTone(status: RequestStatus): Tone {
  if (status === "resolved") return "success";
  if (status === "in_review") return "info";
  return "warning";
}

function statusLabel(status: RequestStatus, hi: boolean): string {
  if (status === "resolved") return hi ? "सुलझाया गया" : "Resolved";
  if (status === "in_review") return hi ? "समीक्षाधीन" : "In review";
  return hi ? "प्रस्तुत" : "Submitted";
}

function formatStamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ServiceRequestThreadScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [reply, setReply] = useState("");

  const detail = useQuery({
    queryKey: ["me", "service-request", id],
    queryFn: () => apiGet<RequestDetail>(`/v1/service-requests/${id}`),
    enabled: !!id,
  });

  const send = useMutation({
    mutationFn: (message: string) =>
      apiPost<{ id: string; status: string; reopened: boolean }>(
        `/v1/service-requests/${id}/messages`,
        { message },
      ),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["me", "service-request", id] });
      qc.invalidateQueries({ queryKey: ["me", "service-requests"] });
    },
    onError: (err) =>
      Alert.alert(
        hi ? "उत्तर नहीं भेजा गया" : "Could not send",
        err instanceof ApiError ? err.message : hi ? "कृपया पुनः प्रयास करें।" : "Please try again.",
      ),
  });

  if (detail.isLoading) {
    return (
      <Screen scroll={false}>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Screen scroll={false}>
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "अनुरोध लोड नहीं हुआ।" : "Could not load this request."}
          onRetry={detail.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      </Screen>
    );
  }

  const data = detail.data;
  const trimmed = reply.trim();

  return (
    <ActivityThemed accent="serviceRequests">
      <Screen refreshing={detail.isRefetching} onRefresh={() => detail.refetch()}>
        <Card>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Title style={{ fontSize: 18 }}>{data.subject}</Title>
              <Body muted style={{ fontSize: 12, marginTop: 4 }}>
                {[data.student_name, data.centre_name].filter(Boolean).join(" · ") || ""}
              </Body>
            </View>
            <Pill label={statusLabel(data.status, hi)} tone={statusTone(data.status)} />
          </Row>
          <View
            style={{
              marginTop: 14,
              backgroundColor: c.muted,
              borderRadius: c.radius,
              padding: 12,
            }}
          >
            <Body style={{ fontSize: 14 }}>{data.description}</Body>
          </View>
        </Card>

        <Title style={{ fontSize: 16, marginLeft: 2 }}>{hi ? "बातचीत" : "Conversation"}</Title>
        {data.messages.length === 0 ? (
          <Card>
            <Body muted>{hi ? "अभी कोई उत्तर नहीं है।" : "No replies yet."}</Body>
          </Card>
        ) : (
          data.messages.map((m) => {
            const mine = !!m.author_user_id && user?.id === m.author_user_id;
            return (
              <Card
                key={m.id}
                style={mine ? { borderColor: c.primary, borderWidth: 1 } : undefined}
              >
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "600", fontSize: 13 }}>
                    {mine ? (hi ? "आप" : "You") : m.author_name ?? (hi ? "टीम" : "Team")}
                  </Body>
                  <Body muted style={{ fontSize: 12 }}>
                    {formatStamp(m.created_at)}
                  </Body>
                </Row>
                <Body style={{ marginTop: 6, fontSize: 14 }}>{m.message}</Body>
              </Card>
            );
          })
        )}

        {data.status === "resolved" ? (
          <Body muted style={{ fontSize: 12, marginLeft: 2 }}>
            {hi
              ? "यह अनुरोध सुलझाया जा चुका है। उत्तर भेजने पर यह फिर से खुल जाएगा।"
              : "This request was resolved. Replying will reopen it."}
          </Body>
        ) : null}

        <Card>
          <Body style={{ fontSize: 13, marginBottom: 6 }}>{hi ? "उत्तर लिखें" : "Write a reply"}</Body>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder={hi ? "अपना संदेश लिखें…" : "Type your message…"}
            placeholderTextColor={c.mutedForeground}
            multiline
            numberOfLines={3}
            maxLength={5000}
            editable={!send.isPending}
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 15,
              color: c.foreground,
              backgroundColor: c.background,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: c.radius,
              paddingHorizontal: 12,
              paddingVertical: 11,
              minHeight: 76,
              textAlignVertical: "top",
            }}
          />
          <Row style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <Button
              label={hi ? "उत्तर भेजें" : "Send reply"}
              icon="paper-plane-outline"
              onPress={() => send.mutate(trimmed)}
              loading={send.isPending}
              disabled={!trimmed || send.isPending}
            />
          </Row>
        </Card>
      </Screen>
    </ActivityThemed>
  );
}
