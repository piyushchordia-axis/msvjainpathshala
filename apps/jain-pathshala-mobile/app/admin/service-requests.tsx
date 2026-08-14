/**
 * Sanchalak / admin request inbox — separate from the parent surface.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { t, type Locale } from "@workspace/i18n";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

function tr(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  return t(`requests.${key}`, locale, vars);
}

const VIEWED_KEY = "jp.admin.sr.viewed";

type RequestStatus = "submitted" | "in_review" | "resolved";
type FilterChip = "open" | "mine" | "resolved";

interface ListRow {
  id: string;
  category: string;
  subject: string;
  status: RequestStatus;
  parent_name: string | null;
  student_name: string | null;
  centre_name: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  last_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

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
  assigned_name: string | null;
  last_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  messages: ThreadMessage[];
}

function statusTone(status: RequestStatus): "success" | "warning" | "info" {
  if (status === "resolved") return "success";
  if (status === "in_review") return "info";
  return "warning";
}

function statusLabel(status: RequestStatus, locale: Locale): string {
  if (status === "resolved") return tr(locale, "statusResolved");
  if (status === "in_review") return tr(locale, "statusInReview");
  return tr(locale, "statusSubmitted");
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

function relativeAge(iso: string, hi: boolean): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return hi ? "अभी" : "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return hi ? "अभी" : "just now";
  if (mins < 60) return hi ? `${mins} मिनट पहले` : `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hi ? `${hrs} घंटे पहले` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return hi ? "1 दिन पहले" : "1 day ago";
  return hi ? `${days} दिन पहले` : `${days} days ago`;
}

async function loadViewed(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(VIEWED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function markViewed(id: string): Promise<void> {
  const map = await loadViewed();
  map[id] = new Date().toISOString();
  await AsyncStorage.setItem(VIEWED_KEY, JSON.stringify(map));
}

function isUnread(row: ListRow, viewed: Record<string, string>): boolean {
  if (!row.last_response_at) return false;
  const lastView = viewed[row.id];
  if (!lastView) return true;
  return new Date(row.last_response_at).getTime() > new Date(lastView).getTime();
}

function ThreadView({
  requestId,
  onBack,
}: {
  requestId: string;
  onBack: () => void;
}) {
  const c = useColors();
  const { hi, locale } = useLocale();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");

  const detail = useQuery({
    queryKey: ["admin", "service-request", requestId],
    queryFn: () => apiGet<RequestDetail>(`/v1/service-requests/${requestId}`),
  });

  useEffect(() => {
    void markViewed(requestId).then(() => {
      void qc.invalidateQueries({ queryKey: ["admin", "service-requests"] });
    });
  }, [requestId, qc]);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["admin", "service-request", requestId] });
    void qc.invalidateQueries({ queryKey: ["admin", "service-requests"] });
    void qc.invalidateQueries({ queryKey: ["admin", "overview"] });
  }, [qc, requestId]);

  const send = useMutation({
    mutationFn: (message: string) =>
      apiPost<{ id: string; status: string; reopened: boolean }>(
        `/v1/service-requests/${requestId}/messages`,
        { message },
      ),
    onSuccess: () => {
      setReply("");
      invalidate();
    },
    onError: (err) =>
      Alert.alert(
        tr(locale, "toastReplyFailedTitle"),
        err instanceof ApiError ? err.message : tr(locale, "pleaseRetry"),
      ),
  });

  const claim = useMutation({
    mutationFn: () =>
      apiPost<{ id: string; status: string }>(`/v1/service-requests/${requestId}/assign`, {}),
    onSuccess: invalidate,
    onError: (err) =>
      Alert.alert(
        tr(locale, "toastClaimFailed"),
        err instanceof ApiError ? err.message : tr(locale, "pleaseRetry"),
      ),
  });

  const resolve = useMutation({
    mutationFn: () =>
      apiPost<{ id: string; status: string }>(`/v1/service-requests/${requestId}/resolve`, {}),
    onSuccess: () => {
      invalidate();
      onBack();
    },
    onError: (err) =>
      Alert.alert(
        tr(locale, "toastResolveFailed"),
        err instanceof ApiError ? err.message : tr(locale, "pleaseRetry"),
      ),
  });

  function confirmResolve() {
    Alert.alert(tr(locale, "resolveConfirm"), tr(locale, "resolveConfirmBody"), [
      { text: tr(locale, "cancel"), style: "cancel" },
      {
        text: tr(locale, "resolve"),
        style: "default",
        onPress: () => resolve.mutate(),
      },
    ]);
  }

  const backControl = (
    <Pressable onPress={onBack} hitSlop={12} style={{ paddingRight: 4 }}>
      <Row style={{ gap: 4 }}>
        <Ionicons name="chevron-back" size={22} color={c.primary} />
        <Body style={{ color: c.primary, fontSize: 14 }}>{tr(locale, "back")}</Body>
      </Row>
    </Pressable>
  );

  if (detail.isLoading) {
    return (
      <ActivityThemed accent="serviceRequests">
        <AppHeader title={tr(locale, "itemTitle")} right={backControl} />
        <StateView status="loading" emptyText="" />
      </ActivityThemed>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <ActivityThemed accent="serviceRequests">
        <AppHeader title={tr(locale, "itemTitle")} right={backControl} />
        <StateView
          status="error"
          emptyText=""
          errorText={tr(locale, "loadFailed")}
          onRetry={detail.refetch}
          retryLabel={tr(locale, "tryAgain")}
        />
      </ActivityThemed>
    );
  }

  const data = detail.data;
  const trimmed = reply.trim();
  const me = user?.id;
  const assignedToOther =
    !!data.assigned_to && !!me && data.assigned_to !== me;
  const canClaim = !data.assigned_to || data.assigned_to === me;
  const busy = send.isPending || claim.isPending || resolve.isPending;

  return (
    <ActivityThemed accent="serviceRequests">
      <AppHeader
        title={data.subject}
        subtitle={
          [data.student_name, data.parent_name].filter(Boolean).join(" · ") ||
          tr(locale, "itemTitle")
        }
        right={backControl}
      />
      <Screen refreshing={detail.isRefetching} onRefresh={() => detail.refetch()}>
        <Card>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
                {data.category}
                {data.centre_name ? ` · ${data.centre_name}` : ""}
              </Body>
              <Body style={{ marginTop: 10, fontSize: 14, lineHeight: 22 }}>{data.description}</Body>
            </View>
            <Pill label={statusLabel(data.status, locale)} tone={statusTone(data.status)} />
          </Row>

          <Row style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
            {assignedToOther ? (
              <Body muted style={{ fontSize: 13, lineHeight: 22, flex: 1 }}>
                {tr(locale, "assignedToName", { name: data.assigned_name ?? "—" })}
              </Body>
            ) : canClaim && data.assigned_to !== me ? (
              <Button
                label={tr(locale, "claim")}
                variant="outline"
                icon="hand-left-outline"
                onPress={() => claim.mutate()}
                loading={claim.isPending}
                disabled={busy}
              />
            ) : data.assigned_to === me ? (
              <Body muted style={{ fontSize: 13, lineHeight: 22 }}>
                {tr(locale, "assignedToYou")}
              </Body>
            ) : null}
            {data.status !== "resolved" ? (
              <Button
                label={tr(locale, "resolve")}
                icon="checkmark-circle-outline"
                onPress={confirmResolve}
                loading={resolve.isPending}
                disabled={busy}
              />
            ) : null}
          </Row>
        </Card>

        <Title style={{ fontSize: 16, marginLeft: 2 }}>{tr(locale, "conversation")}</Title>
        {data.messages.length === 0 ? (
          <Card>
            <Body muted>{tr(locale, "noReplies")}</Body>
          </Card>
        ) : (
          data.messages.map((m) => {
            const mine = !!m.author_user_id && me === m.author_user_id;
            return (
              <Card
                key={m.id}
                style={mine ? { borderColor: c.primary, borderWidth: 1 } : undefined}
              >
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "600", fontSize: 13 }}>
                    {mine ? tr(locale, "you") : m.author_name ?? tr(locale, "parent")}
                  </Body>
                  <Body muted style={{ fontSize: 12 }}>
                    {formatStamp(m.created_at)}
                  </Body>
                </Row>
                <Body style={{ marginTop: 6, fontSize: 14, lineHeight: 22 }}>{m.message}</Body>
              </Card>
            );
          })
        )}

        {data.status === "resolved" ? (
          <Body muted style={{ fontSize: 12, marginLeft: 2, lineHeight: 22 }}>
            {tr(locale, "resolvedReopenHint")}
          </Body>
        ) : null}

        <Card>
          <Body style={{ fontSize: 13, marginBottom: 6, lineHeight: 22 }}>
            {tr(locale, "replyToParent")}
          </Body>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder={tr(locale, "replyMinPlaceholder")}
            placeholderTextColor={c.mutedForeground}
            multiline
            numberOfLines={3}
            maxLength={5000}
            editable={!send.isPending}
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 15,
              lineHeight: 22,
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
          {trimmed.length > 0 && trimmed.length < 5 ? (
            <Body muted style={{ fontSize: 12, marginTop: 6, lineHeight: 22 }}>
              {tr(locale, "replyMinHint")}
            </Body>
          ) : null}
          <Row style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <Button
              label={tr(locale, "sendReply")}
              icon="paper-plane-outline"
              onPress={() => {
                if (trimmed.length < 5) {
                  Alert.alert(tr(locale, "replyTooShort"), tr(locale, "replyMinAlert"));
                  return;
                }
                send.mutate(trimmed);
              }}
              loading={send.isPending}
              disabled={trimmed.length < 5 || busy}
            />
          </Row>
        </Card>
      </Screen>
    </ActivityThemed>
  );
}

export default function AdminServiceRequestsScreen() {
  const c = useColors();
  const { hi, locale } = useLocale();
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterChip>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadViewed().then(setViewed);
  }, [selectedId]);

  const list = useQuery({
    queryKey: ["admin", "service-requests"],
    queryFn: () => apiGet<{ items: ListRow[] }>("/v1/service-requests?limit=200"),
  });

  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    const me = user?.id;
    if (filter === "open") {
      return all.filter((r) => r.status === "submitted" || r.status === "in_review");
    }
    if (filter === "mine") {
      return all.filter((r) => !!me && r.assigned_to === me);
    }
    return all.filter((r) => r.status === "resolved");
  }, [list.data?.items, filter, user?.id]);

  if (selectedId) {
    return (
      <ThreadView
        requestId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void list.refetch();
        }}
      />
    );
  }

  const chips: { id: FilterChip; key: string }[] = [
    { id: "open", key: "filterOpen" },
    { id: "mine", key: "filterMine" },
    { id: "resolved", key: "filterResolved" },
  ];

  return (
    <ActivityThemed accent="serviceRequests">
      <AppHeader
        title={tr(locale, "title")}
        subtitle={tr(locale, "adminSubtitle")}
        showBack
        backHref="/admin/dashboard"
      />
      <Screen refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
        <Row style={{ gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          {chips.map((chip) => {
            const active = filter === chip.id;
            return (
              <Pressable
                key={chip.id}
                onPress={() => setFilter(chip.id)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: c.radius ?? 12,
                  backgroundColor: active ? c.primary : c.muted,
                }}
              >
                <Body
                  style={{
                    fontSize: 13,
                    lineHeight: 22,
                    color: active ? c.primaryForeground : c.foreground,
                    fontWeight: active ? "600" : "400",
                  }}
                >
                  {tr(locale, chip.key)}
                </Body>
              </Pressable>
            );
          })}
        </Row>

        {list.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : list.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={tr(locale, "loadAdminListFailed")}
            onRetry={list.refetch}
            retryLabel={tr(locale, "tryAgain")}
          />
        ) : items.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              filter === "open"
                ? tr(locale, "emptyOpen")
                : filter === "mine"
                  ? tr(locale, "emptyMineAssigned")
                  : tr(locale, "emptyResolvedList")
            }
          />
        ) : (
          items.map((row) => {
            const unread = isUnread(row, viewed);
            return (
              <Pressable key={row.id} onPress={() => setSelectedId(row.id)}>
                <Card>
                  <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Row style={{ alignItems: "center", gap: 8 }}>
                        {unread ? (
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: c.primary,
                            }}
                          />
                        ) : null}
                        <Title style={{ fontSize: 16, lineHeight: 22, flex: 1 }}>
                          {row.subject}
                        </Title>
                      </Row>
                      <Body muted style={{ fontSize: 12, marginTop: 4, lineHeight: 22 }}>
                        {row.category}
                        {row.student_name ? ` · ${row.student_name}` : ""}
                        {row.parent_name ? ` · ${row.parent_name}` : ""}
                      </Body>
                      <Body muted style={{ fontSize: 12, marginTop: 2, lineHeight: 22 }}>
                        {relativeAge(row.created_at, hi)}
                      </Body>
                    </View>
                    <Pill label={statusLabel(row.status, locale)} tone={statusTone(row.status)} />
                  </Row>
                  <Row style={{ marginTop: 8, justifyContent: "flex-end", alignItems: "center" }}>
                    <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
                  </Row>
                </Card>
              </Pressable>
            );
          })
        )}
      </Screen>
    </ActivityThemed>
  );
}
