import { useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { t, type Locale } from "@workspace/i18n";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useChildren } from "@/lib/queries";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

/* Shapes mirror /v1/service-requests exactly (snake_case). */
type RequestStatus = "submitted" | "in_review" | "resolved";

interface MyRequestRow {
  id: string;
  category: string;
  subject: string;
  status: RequestStatus;
  student_name: string | null;
  last_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

type Tone = "success" | "warning" | "info" | "primary" | "neutral";

const CATEGORY_KEYS = [
  { value: "attendance", key: "catAttendance" },
  { value: "enrolment", key: "catEnrolment" },
  { value: "fees", key: "catFees" },
  { value: "id_card", key: "catIdCard" },
  { value: "technical", key: "catTechnical" },
  { value: "other", key: "catOther" },
] as const;

function tr(locale: Locale, key: string): string {
  return t(`requests.${key}`, locale);
}

function statusTone(status: RequestStatus): Tone {
  if (status === "resolved") return "success";
  if (status === "in_review") return "info";
  return "warning";
}

function statusLabel(status: RequestStatus, locale: Locale): string {
  if (status === "resolved") return tr(locale, "statusResolved");
  if (status === "in_review") return tr(locale, "statusInReview");
  return tr(locale, "statusSubmitted");
}

function categoryLabel(value: string, locale: Locale): string {
  const c = CATEGORY_KEYS.find((x) => x.value === value);
  if (!c) return value;
  return tr(locale, c.key);
}

/* ─────────────────────────── create form ─────────────────────────── */

function CreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const c = useColors();
  const { locale } = useLocale();
  const qc = useQueryClient();
  // Optional student picker for parents; absent silently if no children.
  const children = useChildren();
  const childRows = children.data?.items ?? [];

  const [category, setCategory] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [studentId, setStudentId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: {
      category: string;
      subject: string;
      description: string;
      student_id?: string;
    }) => apiPost<{ id: string; status: string }>("/v1/service-requests", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "service-requests"] });
      onCreated();
    },
    onError: (err) =>
      Alert.alert(
        tr(locale, "toastSubmitFailedTitle"),
        err instanceof ApiError ? err.message : tr(locale, "pleaseRetry"),
      ),
  });

  const canSubmit =
    !!category && subject.trim().length > 0 && description.trim().length > 0 && !create.isPending;

  const inputStyle = {
    fontFamily: bodyFamily(locale === "hi"),
    fontSize: 15,
    color: c.foreground,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: c.radius,
    paddingHorizontal: 12,
    paddingVertical: 11,
  } as const;

  function submit() {
    if (!canSubmit || !category) return;
    create.mutate({
      category,
      subject: subject.trim(),
      description: description.trim(),
      student_id: studentId ?? undefined,
    });
  }

  return (
    <Card>
      <Title style={{ fontSize: 18 }}>{tr(locale, "newRequest")}</Title>
      <Body muted style={{ marginTop: 4 }}>
        {tr(locale, "formIntroShort")}
      </Body>

      <Body style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>
        {tr(locale, "category")}
      </Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {CATEGORY_KEYS.map((cat) => {
          const active = category === cat.value;
          return (
            <Pressable
              key={cat.value}
              onPress={() => setCategory(cat.value)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: c.radius,
                borderWidth: 1,
                borderColor: active ? c.primary : c.border,
                backgroundColor: active ? c.primary : "transparent",
              }}
            >
              <Body style={{ fontSize: 13, color: active ? c.primaryForeground : c.foreground }}>
                {tr(locale, cat.key)}
              </Body>
            </Pressable>
          );
        })}
      </View>

      {childRows.length > 0 ? (
        <>
          <Body style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>
            {tr(locale, "studentOptional")}
          </Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {childRows.map((s) => {
              const active = studentId === s.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setStudentId(active ? null : s.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: c.radius,
                    borderWidth: 1,
                    borderColor: active ? c.primary : c.border,
                    backgroundColor: active ? c.primary : "transparent",
                  }}
                >
                  <Body style={{ fontSize: 13, color: active ? c.primaryForeground : c.foreground }}>
                    {s.full_name}
                  </Body>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <Body style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>
        {tr(locale, "subject")}
      </Body>
      <TextInput
        value={subject}
        onChangeText={setSubject}
        placeholder={tr(locale, "subjectPlaceholder")}
        placeholderTextColor={c.mutedForeground}
        maxLength={200}
        style={inputStyle}
      />

      <Body style={{ marginTop: 14, marginBottom: 6, fontSize: 13 }}>
        {tr(locale, "description")}
      </Body>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder={tr(locale, "descriptionPlaceholder")}
        placeholderTextColor={c.mutedForeground}
        multiline
        numberOfLines={4}
        maxLength={5000}
        style={{ ...inputStyle, minHeight: 96, textAlignVertical: "top" }}
      />

      <Row style={{ marginTop: 16, gap: 10 }}>
        <Button
          label={tr(locale, "cancel")}
          variant="outline"
          onPress={onCancel}
          disabled={create.isPending}
          style={{ flex: 1 }}
        />
        <Button
          label={tr(locale, "submit")}
          icon="paper-plane-outline"
          onPress={submit}
          loading={create.isPending}
          disabled={!canSubmit}
          style={{ flex: 1 }}
        />
      </Row>
    </Card>
  );
}

/* ─────────────────────────── screen ─────────────────────────── */

export default function ServiceRequestsScreen() {
  const c = useColors();
  const { locale } = useLocale();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const requests = useQuery({
    queryKey: ["me", "service-requests"],
    queryFn: () => apiGet<{ items: MyRequestRow[] }>("/v1/service-requests/mine?limit=100"),
  });
  const rows = requests.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Screen refreshing={requests.isRefetching} onRefresh={() => requests.refetch()}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Title style={{ fontSize: 22 }}>{tr(locale, "myTitle")}</Title>
            <Body muted style={{ marginTop: -2 }}>
              {tr(locale, "profileHint")}
            </Body>
          </View>
          {!creating ? (
            <Button
              label={tr(locale, "new")}
              icon="add"
              onPress={() => setCreating(true)}
            />
          ) : null}
        </Row>

        {creating ? (
          <CreateForm onCreated={() => setCreating(false)} onCancel={() => setCreating(false)} />
        ) : null}

        {requests.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : requests.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={tr(locale, "loadListFailed")}
            onRetry={requests.refetch}
            retryLabel={tr(locale, "tryAgain")}
          />
        ) : rows.length === 0 ? (
          <StateView
            status="empty"
            emptyText={tr(locale, "emptyMine")}
          />
        ) : (
          rows.map((r) => (
            <Pressable key={r.id} onPress={() => router.push(`/service-request/${r.id}` as never)}>
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Title style={{ fontSize: 16 }}>{r.subject}</Title>
                    <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                      {categoryLabel(r.category, locale)}
                      {r.student_name ? ` · ${r.student_name}` : ""}
                    </Body>
                  </View>
                  <Pill label={statusLabel(r.status, locale)} tone={statusTone(r.status)} />
                </Row>
                <Row style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center" }}>
                  <Body muted style={{ fontSize: 12 }}>
                    {formatDate(r.created_at)}
                  </Body>
                  <Row style={{ gap: 4 }}>
                    <Body style={{ fontSize: 12, color: c.primary }}>
                      {tr(locale, "open")}
                    </Body>
                    <Ionicons name="chevron-forward" size={14} color={c.primary} />
                  </Row>
                </Row>
              </Card>
            </Pressable>
          ))
        )}
      </Screen>
    </View>
  );
}
