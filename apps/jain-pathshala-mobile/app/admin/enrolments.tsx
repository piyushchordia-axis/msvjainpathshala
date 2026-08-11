import { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { fonts, bodyFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminEnrolments, useEnrolmentAction } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const FILTERS = [
  { key: "", en: "All", hi: "सभी" },
  { key: "pending", en: "Pending", hi: "लंबित" },
  { key: "waitlisted", en: "Waitlisted", hi: "प्रतीक्षा" },
  { key: "approved", en: "Approved", hi: "स्वीकृत" },
  { key: "rejected", en: "Rejected", hi: "अस्वीकृत" },
];

const REJECT_REASON_MIN = 10;
const REJECT_REASON_MAX = 300;

const REJECT_PRESETS = [
  {
    en: "Batch is full for this age group",
    hi: "इस आयु वर्ग के लिए बैच भर गया है",
  },
  {
    en: "Centre is outside the requested area",
    hi: "केंद्र अनुरोधित क्षेत्र से बाहर है",
  },
  {
    en: "Details incomplete — please reapply with the student's date of birth",
    hi: "विवरण अधूरे हैं — कृपया विद्यार्थी की जन्म तिथि के साथ फिर से आवेदन करें",
  },
];

function tone(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "approved") return "success";
  if (status === "waitlisted" || status === "pending") return "warning";
  if (status === "rejected") return "error";
  return "neutral";
}

function RejectSheet({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  busy: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const trimmed = reason.trim();
  const count = trimmed.length;
  const valid = count >= REJECT_REASON_MIN && count <= REJECT_REASON_MAX;

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Title style={{ fontSize: 20, lineHeight: 28, flex: 1, paddingRight: 12 }}>
            {hi ? "नामांकन अस्वीकृत करें" : "Reject enrolment"}
          </Title>
          <Pressable onPress={onClose} hitSlop={12} disabled={busy}>
            <Text style={{ color: c.primary, fontFamily: bodyFamily(hi, "semibold") }}>
              {hi ? "बंद करें" : "Close"}
            </Text>
          </Pressable>
        </View>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}
          bottomOffset={20}
          keyboardShouldPersistTaps="handled"
        >
          <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
            {hi
              ? `कारण * (कम से कम ${REJECT_REASON_MIN} अक्षर) — अभिभावक को दिखेगा`
              : `Reason * (at least ${REJECT_REASON_MIN} characters) — shown to the parent`}
          </Body>
          <Row style={{ flexWrap: "wrap", gap: 8 }}>
            {REJECT_PRESETS.map((p) => {
              const label = hi ? p.hi : p.en;
              return (
                <Pressable
                  key={p.en}
                  onPress={() => setReason(label)}
                  disabled={busy}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: c.radius,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.card,
                  }}
                >
                  <Text style={{ fontFamily: bodyFamily(hi), fontSize: 12, color: c.foreground, lineHeight: 18 }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
          <TextInput
            value={reason}
            onChangeText={setReason}
            editable={!busy}
            multiline
            maxLength={REJECT_REASON_MAX}
            placeholder={hi ? "कारण लिखें…" : "Write a reason…"}
            placeholderTextColor={c.mutedForeground}
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 15,
              lineHeight: 22,
              color: c.foreground,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: c.radius,
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: c.card,
              minHeight: 100,
              textAlignVertical: "top",
            }}
          />
          <Body muted style={{ fontSize: 12, textAlign: "right" }}>
            {count}/{REJECT_REASON_MAX}
            {count > 0 && count < REJECT_REASON_MIN
              ? hi
                ? ` · ${REJECT_REASON_MIN - count} और`
                : ` · ${REJECT_REASON_MIN - count} more`
              : ""}
          </Body>
          <Button
            label={hi ? "अस्वीकृत करें" : "Reject"}
            onPress={() => onSubmit(trimmed)}
            disabled={!valid || busy}
            loading={busy}
          />
        </KeyboardAwareScrollViewCompat>
      </View>
    </Modal>
  );
}

export default function EnrolmentsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const [filter, setFilter] = useState("");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const { data, isLoading, isError, refetch, isRefetching } = useAdminEnrolments(filter || undefined);
  const mutate = useEnrolmentAction();

  const items = data?.items ?? [];

  const run = (id: string, action: "approve" | "waitlist", reason?: string) =>
    mutate.mutate(
      { id, action, reason },
      {
        onError: (e) =>
          Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed"),
      },
    );

  const onReject = (reason: string) => {
    if (!rejectId) return;
    mutate.mutate(
      { id: rejectId, action: "reject", reason },
      {
        onSuccess: () => setRejectId(null),
        onError: (e) =>
          Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed"),
      },
    );
  };

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
              style={{
                backgroundColor: active ? c.primary : c.muted,
                borderRadius: 999,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.bodySemiBold,
                  fontSize: 13,
                  color: active ? c.primaryForeground : c.mutedForeground,
                }}
              >
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
            const subtitle = [e.student_code, e.centre_name, e.batch_name].filter(Boolean).join(" · ");
            return (
              <Card key={e.id}>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Title style={{ fontSize: 17 }}>
                      {e.student_name?.trim() || e.student_code || (hi ? "विद्यार्थी" : "Student")}
                    </Title>
                    {subtitle ? (
                      <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                        {subtitle}
                      </Body>
                    ) : null}
                  </View>
                  <Pill tone={tone(e.status)} label={e.status} />
                </Row>
                <Body muted style={{ fontSize: 12, marginTop: 8 }}>
                  {hi ? "जमा" : "Submitted"}: {formatDate(e.created_at)}
                </Body>
                {e.decided_at ? (
                  <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                    {hi ? "निर्णय" : "Decided"}: {formatDate(e.decided_at)}
                  </Body>
                ) : null}
                {actionable ? (
                  <Row style={{ gap: 8, marginTop: 12 }}>
                    <Button
                      label={hi ? "स्वीकृत" : "Approve"}
                      onPress={() => run(e.id, "approve")}
                      style={{ flex: 1 }}
                      loading={mutate.isPending && mutate.variables?.id === e.id && mutate.variables?.action === "approve"}
                    />
                    <Button
                      label={hi ? "प्रतीक्षा" : "Waitlist"}
                      variant="secondary"
                      onPress={() => run(e.id, "waitlist")}
                      style={{ flex: 1 }}
                      loading={mutate.isPending && mutate.variables?.id === e.id && mutate.variables?.action === "waitlist"}
                    />
                    <Button
                      label={hi ? "अस्वीकृत" : "Reject"}
                      variant="outline"
                      onPress={() => setRejectId(e.id)}
                      style={{ flex: 1 }}
                    />
                  </Row>
                ) : null}
              </Card>
            );
          })
        )}
      </Screen>

      <RejectSheet
        open={!!rejectId}
        onClose={() => setRejectId(null)}
        onSubmit={onReject}
        busy={mutate.isPending && mutate.variables?.action === "reject"}
      />
    </View>
  );
}
