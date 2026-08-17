/**
 * Shared join approval queue for shikshak / sanchalak / city_admin.
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { fonts } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Row, StateView, Title } from "@/components/ui";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { joinKindLabel, recordStatusLabel } from "@/lib/status-labels";

type JoinKind = "student" | "shikshak" | "sanchalak";
type StatusFilter = "pending" | "approved" | "rejected";

type RowItem = {
  id: string;
  display_code: string;
  name: string;
  status: string;
  mobile?: string;
  parent_mobile?: string;
  whatsapp_contact?: string;
  centre_name?: string;
  city_name?: string;
  role?: string | null;
};

function kindsForRole(role: string | undefined): JoinKind[] {
  if (role === "shikshak") return ["student"];
  if (role === "sanchalak") return ["student", "shikshak"];
  if (role === "city_admin" || role === "state_admin" || role === "super_admin") {
    return ["student", "shikshak", "sanchalak"];
  }
  return [];
}

export function JoinApprovalsScreen({ initialKind }: { initialKind?: JoinKind }) {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const router = useRouter();
  const allowed = kindsForRole(user?.role);
  const [kind, setKind] = useState<JoinKind>(
    initialKind && allowed.includes(initialKind) ? initialKind : (allowed[0] ?? "student"),
  );
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<RowItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // A blank list with a bare red string was indistinguishable from "nothing
  // pending", and switching filters refetched with no spinner at all.
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!allowed.length) return;
    setError(null);
    setLoading(true);
    try {
      const list = await apiGet<{ items: RowItem[] }>(
        `/v1/join/registrations?kind=${kind}&status=${status}`,
      );
      setItems(list.items);
    } catch (e) {
      setError(apiErrorMessage(e, hi));
    } finally {
      setLoading(false);
    }
  }, [allowed.length, kind, status, hi]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (id: string) => {
    setBusy(true);
    try {
      await apiPost(`/v1/join/registrations/${id}/approve?kind=${kind}`, {});
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, hi));
    } finally {
      setBusy(false);
    }
  };

  /** Approval provisions a real login — confirm before committing. */
  const confirmApprove = (row: RowItem) => {
    Alert.alert(
      hi ? "स्वीकृत करें?" : "Approve?",
      hi
        ? `${row.name ?? ""} का पंजीकरण स्वीकृत किया जाएगा और खाता बनाया जाएगा।`
        : `This approves ${row.name ?? "this registration"} and provisions their account.`,
      [
        { text: hi ? "रद्द करें" : "Cancel", style: "cancel" },
        { text: hi ? "स्वीकृत करें" : "Approve", onPress: () => void approve(row.id) },
      ],
    );
  };

  const reject = async () => {
    if (!rejectId || !rejectReason.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/v1/join/registrations/${rejectId}/reject?kind=${kind}`, {
        reason: rejectReason.trim(),
      });
      setRejectId(null);
      setRejectReason("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  };

  const backControl = (
    <Pressable onPress={() => router.back()} hitSlop={12} style={{ paddingRight: 4 }}>
      <Row style={{ gap: 4 }}>
        <Ionicons name="chevron-back" size={22} color={c.primary} />
        <Body style={{ color: c.primary, fontSize: 14 }}>{hi ? "पीछे" : "Back"}</Body>
      </Row>
    </Pressable>
  );

  if (!allowed.length) {
    return (
      <ActivityThemed accent="join">
        <AppHeader title={hi ? "Join स्वीकृति" : "Join approvals"} right={backControl} />
        <Body muted style={{ paddingHorizontal: 18 }}>
          {hi ? "पहुँच नहीं" : "No access"}
        </Body>
      </ActivityThemed>
    );
  }

  const chip = (active: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: active ? c.primary : c.card,
    borderWidth: 1,
    borderColor: c.border,
    marginRight: 8,
    marginBottom: 8,
  });

  return (
    <ActivityThemed accent="join">
      <AppHeader
        title={hi ? "Join स्वीकृति" : "Join approvals"}
        subtitle={
          hi ? "लंबित पंजीकरण स्वीकृत या अस्वीकृत करें" : "Approve or reject pending registrations"
        }
        right={backControl}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40, gap: 4 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {allowed.map((k) => (
            <Pressable key={k} onPress={() => setKind(k)} style={chip(k === kind)}>
              <Body style={{ color: k === kind ? c.primaryForeground : c.foreground, fontSize: 13 }}>
                {joinKindLabel(k, hi)}
              </Body>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8 }}>
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <Pressable key={s} onPress={() => setStatus(s)} style={chip(s === status)}>
              <Body style={{ color: s === status ? c.primaryForeground : c.foreground, fontSize: 13 }}>
                {recordStatusLabel(s, hi)}
              </Body>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : error ? (
          <StateView
            status="error"
            emptyText=""
            errorText={error}
            onRetry={() => void load()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              status === "pending"
                ? hi
                  ? "कोई पंजीकरण लंबित नहीं है।"
                  : "No registrations waiting."
                : hi
                  ? "यहाँ कुछ नहीं है।"
                  : "Nothing here."
            }
          />
        ) : null}

        {items.map((row) => (
          <Card key={row.id} style={{ padding: 14, marginBottom: 10 }}>
            <Title style={{ fontSize: 16 }}>{row.name}</Title>
            <Body muted style={{ fontFamily: fonts.mono, marginTop: 4 }}>
              {row.display_code}
            </Body>
            <Body muted style={{ marginTop: 4 }}>
              {row.centre_name ?? "—"}
              {row.city_name ? ` · ${row.city_name}` : ""}
            </Body>
            <Body muted style={{ marginTop: 2 }}>
              {row.parent_mobile ?? row.mobile ?? row.whatsapp_contact ?? ""}
            </Body>
            {status === "pending" ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <Button
                  label={hi ? "स्वीकृत" : "Approve"}
                  style={{ flex: 1 }}
                  loading={busy}
                  onPress={() => confirmApprove(row)}
                />
                <Button
                  label={hi ? "अस्वीकृत" : "Reject"}
                  variant="outline"
                  style={{ flex: 1 }}
                  disabled={busy}
                  onPress={() => {
                    setRejectId(row.id);
                    setRejectReason("");
                  }}
                />
              </View>
            ) : null}
          </Card>
        ))}

        {items.length === 0 ? (
          <Body muted style={{ marginTop: 16 }}>
            {hi ? "कोई पंजीकरण नहीं" : "No registrations in this queue"}
          </Body>
        ) : null}

        {rejectId ? (
          <Card style={{ padding: 14, marginTop: 12 }}>
            <Title style={{ fontSize: 16 }}>{hi ? "अस्वीकृति कारण" : "Rejection reason"}</Title>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {(hi
                ? ["अधूरी जानकारी", "गलत केंद्र", "डुप्लिकेट"]
                : ["Incomplete details", "Wrong centre", "Duplicate"]
              ).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRejectReason(r)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: rejectReason === r ? c.primary : c.border,
                    backgroundColor: rejectReason === r ? c.primary : c.card,
                  }}
                >
                  <Body
                    style={{
                      fontSize: 12,
                      color: rejectReason === r ? c.primaryForeground : c.foreground,
                    }}
                  >
                    {r}
                  </Body>
                </Pressable>
              ))}
            </View>
            <Button
              label={hi ? "पुष्टि करें" : "Confirm reject"}
              style={{ marginTop: 12 }}
              disabled={busy || !rejectReason.trim()}
              onPress={() => void reject()}
            />
            <Button
              label={hi ? "रद्द" : "Cancel"}
              variant="outline"
              style={{ marginTop: 8 }}
              onPress={() => setRejectId(null)}
            />
          </Card>
        ) : null}
      </ScrollView>
    </ActivityThemed>
  );
}
