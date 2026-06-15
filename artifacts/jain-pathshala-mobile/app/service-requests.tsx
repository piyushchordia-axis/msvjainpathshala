import { useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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

/** Category options kept in parity with the web member form. */
const CATEGORIES: { value: string; en: string; hi: string }[] = [
  { value: "attendance", en: "Attendance", hi: "उपस्थिति" },
  { value: "enrolment", en: "Enrolment", hi: "नामांकन" },
  { value: "fees", en: "Fees & donations", hi: "शुल्क व दान" },
  { value: "id_card", en: "ID card", hi: "पहचान पत्र" },
  { value: "technical", en: "App / technical", hi: "ऐप / तकनीकी" },
  { value: "other", en: "Other", hi: "अन्य" },
];

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

function categoryLabel(value: string, hi: boolean): string {
  const c = CATEGORIES.find((x) => x.value === value);
  if (!c) return value;
  return hi ? c.hi : c.en;
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
  const { hi } = useLocale();
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
        hi ? "अनुरोध नहीं भेजा गया" : "Could not submit",
        err instanceof ApiError ? err.message : hi ? "कृपया पुनः प्रयास करें।" : "Please try again.",
      ),
  });

  const canSubmit =
    !!category && subject.trim().length > 0 && description.trim().length > 0 && !create.isPending;

  const inputStyle = {
    fontFamily: bodyFamily(hi),
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
      <Title style={{ fontSize: 18 }}>{hi ? "नया अनुरोध" : "New request"}</Title>
      <Body muted style={{ marginTop: 4 }}>
        {hi
          ? "अपनी समस्या बताएं — आपके केंद्र की टीम उत्तर देगी।"
          : "Describe your issue — your centre team will respond."}
      </Body>

      <Body style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>
        {hi ? "श्रेणी" : "Category"}
      </Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {CATEGORIES.map((cat) => {
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
                {hi ? cat.hi : cat.en}
              </Body>
            </Pressable>
          );
        })}
      </View>

      {childRows.length > 0 ? (
        <>
          <Body style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>
            {hi ? "विद्यार्थी (वैकल्पिक)" : "Student (optional)"}
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
        {hi ? "विषय" : "Subject"}
      </Body>
      <TextInput
        value={subject}
        onChangeText={setSubject}
        placeholder={hi ? "संक्षिप्त विषय" : "A short subject"}
        placeholderTextColor={c.mutedForeground}
        maxLength={200}
        style={inputStyle}
      />

      <Body style={{ marginTop: 14, marginBottom: 6, fontSize: 13 }}>
        {hi ? "विवरण" : "Description"}
      </Body>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder={hi ? "अपनी समस्या विस्तार से लिखें…" : "Describe your issue in detail…"}
        placeholderTextColor={c.mutedForeground}
        multiline
        numberOfLines={4}
        maxLength={5000}
        style={{ ...inputStyle, minHeight: 96, textAlignVertical: "top" }}
      />

      <Row style={{ marginTop: 16, gap: 10 }}>
        <Button
          label={hi ? "रद्द करें" : "Cancel"}
          variant="outline"
          onPress={onCancel}
          disabled={create.isPending}
          style={{ flex: 1 }}
        />
        <Button
          label={hi ? "भेजें" : "Submit"}
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
  const { hi } = useLocale();
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
            <Title style={{ fontSize: 22 }}>{hi ? "मेरे अनुरोध" : "My requests"}</Title>
            <Body muted style={{ marginTop: -2 }}>
              {hi ? "अपने केंद्र की टीम से सहायता" : "Support from your centre team"}
            </Body>
          </View>
          {!creating ? (
            <Button
              label={hi ? "नया" : "New"}
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
            errorText={hi ? "अनुरोध लोड नहीं हुए।" : "Could not load your requests."}
            onRetry={requests.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : rows.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "अभी आपका कोई अनुरोध नहीं है।" : "You have no requests yet."}
          />
        ) : (
          rows.map((r) => (
            <Pressable key={r.id} onPress={() => router.push(`/service-request/${r.id}` as never)}>
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Title style={{ fontSize: 16 }}>{r.subject}</Title>
                    <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                      {categoryLabel(r.category, hi)}
                      {r.student_name ? ` · ${r.student_name}` : ""}
                    </Body>
                  </View>
                  <Pill label={statusLabel(r.status, hi)} tone={statusTone(r.status)} />
                </Row>
                <Row style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center" }}>
                  <Body muted style={{ fontSize: 12 }}>
                    {formatDate(r.created_at)}
                  </Body>
                  <Row style={{ gap: 4 }}>
                    <Body style={{ fontSize: 12, color: c.primary }}>
                      {hi ? "खोलें" : "Open"}
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
