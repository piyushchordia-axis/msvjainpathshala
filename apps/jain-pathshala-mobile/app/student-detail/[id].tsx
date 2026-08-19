import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Image as ExpoImage } from "expo-image";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessAdminPanel } from "@/lib/auth";
import { resolveUploadUrl, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { formatAgeGroup } from "@workspace/api-zod";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { ulid } from "@/lib/offline/ulid";
import {
  useAdminIdCard,
  useAdminNiyamByStudent,
  useAdminStudentDetail,
  useAdminStudentPunya,
  useAttendance,
  useAwardPunya,
  usePunyaAwardCategories,
  usePunyaAwardLimit,
  useStudentHomeworkHistory,
} from "@/lib/queries";
import { recordStatusLabel, attendanceStatusLabel } from "@/lib/status-labels";
import { punyaFeatureLabel } from "@/lib/punya-labels";
import { Body, Button, Card, Numeric, Pill, Row, StateView, Title } from "@/components/ui";

type SectionKey =
  | "contact"
  | "idcard"
  | "attendance"
  | "punya"
  | "homework"
  | "niyam"
  | "progress";

const SECTIONS: Array<{ key: SectionKey; en: string; hi: string }> = [
  { key: "contact", en: "Contact", hi: "संपर्क" },
  { key: "idcard", en: "ID card", hi: "पहचान पत्र" },
  { key: "attendance", en: "Attendance", hi: "उपस्थिति" },
  { key: "punya", en: "Punya", hi: "पुण्य" },
  { key: "homework", en: "Homework", hi: "गृहकार्य" },
  { key: "niyam", en: "Niyam", hi: "नियम" },
  { key: "progress", en: "Progress", hi: "प्रगति" },
];

function attendanceTone(status: string): "success" | "warning" | "error" | "neutral" {
  const s = status.toLowerCase();
  if (s === "present") return "success";
  if (s === "late") return "warning";
  if (s === "absent") return "error";
  return "neutral";
}

function homeworkTone(status: string): "success" | "warning" | "error" | "info" | "neutral" | "primary" {
  const s = status.toLowerCase();
  if (s === "approved" || s === "starred") return "success";
  if (s === "submitted" || s === "acknowledged") return "info";
  if (s === "returned" || s === "late") return "warning";
  if (s === "pending") return "neutral";
  return "neutral";
}

function relationLabel(relation: string | null | undefined, hi: boolean): string {
  const r = (relation ?? "").toLowerCase();
  if (r === "father") return hi ? "पिता" : "Father";
  if (r === "mother") return hi ? "माता" : "Mother";
  if (r === "guardian") return hi ? "अभिभावक" : "Guardian";
  return relation || (hi ? "अभिभावक" : "Parent");
}

function SectionChips({
  active,
  onChange,
}: {
  active: SectionKey;
  onChange: (key: SectionKey) => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: c.background,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      {SECTIONS.map((s) => {
        const on = s.key === active;
        return (
          <Pressable
            key={s.key}
            onPress={() => onChange(s.key)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: on ? c.primary : c.muted,
            }}
          >
            <Text
              style={{
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 13,
                color: on ? c.primaryForeground : c.mutedForeground,
              }}
            >
              {hi ? s.hi : s.en}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ContactPanel({ studentId }: { studentId: string }) {
  const c = useColors();
  const { hi } = useLocale();
  const detail = useAdminStudentDetail(studentId, true);
  const row = detail.data;

  if (detail.isLoading) return <StateView status="loading" emptyText="" />;
  if (detail.isError || !row) {
    return (
      <StateView
        status="error"
        emptyText=""
        errorText={hi ? "विवरण लोड नहीं हुआ।" : "Could not load student details."}
        onRetry={detail.refetch}
        retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Title style={{ fontSize: 18 }}>{row.full_name.trim()}</Title>
        <Body muted style={{ marginTop: 4, fontSize: 13 }}>
          {[row.student_code, formatAgeGroup(row.age_group, hi ? "hi" : "en")]
            .filter(Boolean)
            .join(" · ")}
        </Body>
        <Row style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Pill
            tone={row.status === "active" ? "success" : "neutral"}
            label={recordStatusLabel(row.status, hi)}
          />
          {row.msv_status && row.msv_status !== "none" ? (
            <Pill label={`MSV: ${row.msv_status}`} />
          ) : null}
          {row.blood_group ? <Pill label={row.blood_group} tone="neutral" /> : null}
        </Row>
        {row.dob ? (
          <Body muted style={{ marginTop: 10, fontSize: 13 }}>
            {hi ? "जन्म तिथि" : "Date of birth"}: {formatDate(row.dob)}
          </Body>
        ) : null}
        <Body muted style={{ marginTop: 4, fontSize: 13 }}>
          {[row.batch_name, row.centre_name].filter(Boolean).join(" · ") || "—"}
        </Body>
      </Card>

      <Card>
        <Title style={{ fontSize: 16 }}>{hi ? "अभिभावक" : "Parent"}</Title>
        {row.parent ? (
          <View style={{ marginTop: 8, gap: 4 }}>
            <Body style={{ fontFamily: bodyFamily(hi, "semibold") }}>
              {row.parent.full_name ?? "—"}
            </Body>
            <Body muted style={{ fontSize: 13 }}>
              {relationLabel(row.parent.relation, hi)}
            </Body>
            <Body style={{ fontSize: 15, marginTop: 4, color: c.primary }}>
              {row.parent.phone ?? (hi ? "फ़ोन उपलब्ध नहीं" : "No phone on file")}
            </Body>
          </View>
        ) : (
          <Body muted style={{ marginTop: 8 }}>
            {hi ? "अभिभावक विवरण उपलब्ध नहीं।" : "No parent details on file."}
          </Body>
        )}
      </Card>

      <Card>
        <Title style={{ fontSize: 16 }}>{hi ? "विद्यार्थी फ़ोन" : "Student phone"}</Title>
        <Body style={{ marginTop: 8, fontSize: 15, color: row.student_phone ? c.primary : c.mutedForeground }}>
          {row.student_phone ?? (hi ? "लिंक नहीं" : "Not linked")}
        </Body>
      </Card>
    </View>
  );
}

function IdCardPanel({ studentId }: { studentId: string }) {
  const c = useColors();
  const { hi } = useLocale();
  const card = useAdminIdCard(studentId, true);
  const row = card.data;
  const pngUri = resolveUploadUrl(row?.png_url);
  const [imageFailed, setImageFailed] = useState(false);
  const cardArtKey = row?.png_url
    ? `${row.png_url}:${row.last_regenerated_at ?? row.version_no ?? ""}`
    : "";

  useEffect(() => {
    setImageFailed(false);
  }, [cardArtKey]);

  if (card.isLoading) return <StateView status="loading" emptyText="" />;
  if (card.isError) {
    return (
      <StateView
        status="error"
        emptyText=""
        errorText={hi ? "पहचान पत्र लोड नहीं हुआ।" : "Could not load ID card."}
        onRetry={card.refetch}
        retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
      />
    );
  }
  if (!row || !pngUri) {
    return (
      <StateView
        status="empty"
        emptyText={
          hi
            ? "इस विद्यार्थी का पहचान पत्र अभी तैयार नहीं है।"
            : "No ID card has been generated for this student yet."
        }
      />
    );
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <Row style={{ justifyContent: "space-between", padding: 12 }}>
        <Body muted style={{ fontSize: 12 }}>
          {row.card_number}
        </Body>
        <Pill
          tone={row.is_active ? "success" : "neutral"}
          label={row.is_active ? (hi ? "सक्रिय" : "Active") : hi ? "निष्क्रिय" : "Inactive"}
        />
      </Row>
      {pngUri && !imageFailed ? (
        <ExpoImage
          key={cardArtKey || pngUri}
          source={{ uri: pngUri }}
          style={{
            width: "100%",
            aspectRatio: 480 / 640,
            backgroundColor: c.muted,
          }}
          contentFit="contain"
          accessibilityLabel={hi ? "पहचान पत्र छवि" : "ID card image"}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View
          style={{
            width: "100%",
            aspectRatio: 480 / 640,
            backgroundColor: c.muted,
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <Body muted style={{ textAlign: "center", fontSize: 13 }}>
            {hi
              ? "पहचान पत्र छवि लोड नहीं हुई। पुनः प्रयास करें।"
              : "Could not load the ID card image. Try again."}
          </Body>
        </View>
      )}
    </Card>
  );
}

function AttendancePanel({ studentId }: { studentId: string }) {
  const c = useColors();
  const { hi } = useLocale();
  const attendance = useAttendance(studentId, true);
  const rows = attendance.data?.items ?? [];
  const presentRate =
    attendance.data?.attendance_percent ??
    (attendance.data?.attendance_rate != null
      ? Math.round(attendance.data.attendance_rate * 100)
      : null);

  if (attendance.isLoading) return <StateView status="loading" emptyText="" />;
  if (attendance.isError) {
    return (
      <StateView
        status="error"
        emptyText=""
        errorText={hi ? "उपस्थिति लोड नहीं हुई।" : "Could not load attendance."}
        onRetry={attendance.refetch}
        retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {presentRate !== null ? (
        <Pill
          label={hi ? `${presentRate}% उपस्थित` : `${presentRate}% present`}
          tone={presentRate >= 75 ? "success" : presentRate >= 50 ? "warning" : "error"}
        />
      ) : null}
      {rows.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "अभी कोई उपस्थिति दर्ज नहीं है।" : "No attendance recorded yet."}
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {rows.map((row, i) => (
            <View
              key={row.id}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                borderBottomColor: c.border,
              }}
            >
              <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontFamily: bodyFamily(hi, "semibold") }}>
                  {formatDate(row.session_date)}
                </Body>
                <Pill label={attendanceStatusLabel(row.status, hi)} tone={attendanceTone(row.status)} />
              </Row>
              {row.topic ? (
                <Body muted style={{ marginTop: 2, fontSize: 13 }}>
                  {row.topic}
                </Body>
              ) : null}
              {row.batch_name ? (
                <Body muted style={{ marginTop: 2, fontSize: 12 }}>
                  {row.batch_name}
                </Body>
              ) : null}
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

function PunyaPanel({ studentId }: { studentId: string }) {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const canAward = canAccessAdminPanel(user?.role);
  const [sheetOpen, setSheetOpen] = useState(false);
  const punya = useAdminStudentPunya(studentId, true);
  const summary = punya.data;
  const transactions = summary?.transactions ?? [];

  if (punya.isLoading) return <StateView status="loading" emptyText="" />;
  if (punya.isError) {
    return (
      <StateView
        status="error"
        emptyText=""
        errorText={hi ? "पुण्य लोड नहीं हुआ।" : "Could not load Punya."}
        onRetry={punya.refetch}
        retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {canAward ? (
        <Button
          label={hi ? "पुण्य दें" : "Award Punya"}
          onPress={() => setSheetOpen(true)}
        />
      ) : null}
      <Card>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <Body muted style={{ fontSize: 13, lineHeight: 22 }}>
            {hi ? "कुल पुण्य अंक" : "Total Punya points"}
          </Body>
          <Pill label={summary?.tier ?? "—"} tone="primary" />
        </Row>
        <Numeric style={{ fontSize: 44, marginTop: 8 }}>{summary?.total_points ?? 0}</Numeric>
      </Card>
      <Title style={{ fontSize: 16, lineHeight: 24 }}>{hi ? "लेन-देन" : "Transactions"}</Title>
      {transactions.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "अभी कोई लेन-देन नहीं।" : "No Punya transactions yet."}
        />
      ) : (
        transactions.map((t) => (
          <Card key={t.id}>
            <Row style={{ justifyContent: "space-between" }}>
              <Body style={{ fontFamily: bodyFamily(hi, "semibold"), flex: 1, paddingRight: 8, lineHeight: 22 }}>
                {punyaFeatureLabel(t.feature_key, hi)}
              </Body>
              <Body style={{ color: t.points >= 0 ? c.primary : c.destructive }}>
                {t.points >= 0 ? `+${t.points}` : t.points}
              </Body>
            </Row>
            <Body muted style={{ fontSize: 12, marginTop: 4, lineHeight: 22 }}>
              {formatDate(t.created_at)}
            </Body>
            {t.note ? (
              <Body muted style={{ fontSize: 12, marginTop: 2, lineHeight: 22 }}>
                {t.note}
              </Body>
            ) : null}
          </Card>
        ))
      )}
      {canAward ? (
        <AwardPunyaSheet
          studentId={studentId}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

const REASON_PRESETS: Array<{ en: string; hi: string }> = [
  { en: "Helped in class", hi: "कक्षा में सहायता" },
  { en: "Excellent recitation", hi: "उत्तम पाठ" },
  { en: "Kind act", hi: "दयालु कार्य" },
  { en: "Extra effort", hi: "विशेष प्रयास" },
];

function AwardPunyaSheet({
  studentId,
  open,
  onClose,
}: {
  studentId: string;
  open: boolean;
  onClose: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const limitQ = usePunyaAwardLimit(open);
  const categoriesQ = usePunyaAwardCategories(open);
  const award = useAwardPunya();
  const [points, setPoints] = useState(0);
  const [reason, setReason] = useState("");
  // H6 — BRD 7.2's category. `manual_award` is the generic bucket every
  // award used to land in, and stays the default.
  const [categoryKey, setCategoryKey] = useState("manual_award");
  const [idempotencyKey, setIdempotencyKey] = useState(() => ulid());
  const [formError, setFormError] = useState<string | null>(null);

  const maxPerAward = limitQ.data?.max_points_per_award ?? 0;
  const remainingToday = limitQ.data?.remaining_today ?? null;
  const maxPerDay = limitQ.data?.max_points_per_day ?? null;
  const categories = categoriesQ.data?.items ?? [];
  const category = categories.find((x) => x.key === categoryKey) ?? null;
  // The tightest of the role ceiling, today's remainder and the CATEGORY's
  // own maximum — a Seva award stops at 50 however senior the awarder is.
  const effectiveMax = Math.max(
    0,
    Math.min(
      maxPerAward,
      remainingToday == null ? maxPerAward : remainingToday,
      category?.max_points ?? maxPerAward,
    ),
  );
  const categoryMin = category?.min_points ?? 0;

  // Mint a fresh idempotency key only when the sheet opens — retries reuse it.
  useEffect(() => {
    if (!open) return;
    setPoints(0);
    setReason("");
    setCategoryKey("manual_award");
    setFormError(null);
    setIdempotencyKey(ulid());
  }, [open]);

  useEffect(() => {
    setPoints((p) => (effectiveMax <= 0 ? 0 : Math.min(p, effectiveMax)));
  }, [effectiveMax]);

  function clampPoints(next: number): number {
    if (effectiveMax <= 0) return 0;
    return Math.max(0, Math.min(effectiveMax, next));
  }

  function addPoints(delta: number) {
    setPoints((p) => clampPoints(p + delta));
  }

  function submit() {
    const note = reason.trim();
    if (points <= 0 || note.length < 3) return;
    if (points < categoryMin) return;
    if (remainingToday === 0) return;
    setFormError(null);
    award.mutate(
      {
        student_id: studentId,
        points,
        note,
        feature_key: categoryKey,
        idempotency_key: idempotencyKey,
      },
      {
        onSuccess: (res) => {
          Alert.alert(
            hi ? "पुण्य दिया गया" : "Punya awarded",
            hi
              ? `कुल ${res.total_points} · स्तर ${res.tier}`
              : `Total ${res.total_points} · tier ${res.tier}`,
          );
          onClose();
        },
        onError: (err) => {
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : hi
                  ? "पुरस्कार नहीं दिया जा सका।"
                  : "Could not award Punya.";
          // Limit errors: surface the server message verbatim (states the fix).
          if (
            err instanceof ApiError &&
            (err.code === "ERR_AWARD_LIMIT_EXCEEDED" ||
              err.code === "ERR_AWARD_DAILY_LIMIT_EXCEEDED")
          ) {
            setFormError(msg);
            Alert.alert(hi ? "सीमा" : "Limit reached", msg);
            return;
          }
          setFormError(msg);
          Alert.alert(hi ? "त्रुटि" : "Could not award", msg);
        },
      },
    );
  }

  const reasonOk = reason.trim().length >= 3;
  const confirmDisabled =
    award.isPending ||
    points <= 0 ||
    points < categoryMin ||
    !reasonOk ||
    remainingToday === 0 ||
    effectiveMax <= 0 ||
    limitQ.isLoading;

  const fieldStyle = {
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
  } as const;

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ActivityThemed accent="students">
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Title style={{ fontSize: 20, lineHeight: 28, flex: 1, paddingRight: 12 }}>
            {hi ? "पुण्य दें" : "Award Punya"}
          </Title>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ fontSize: 16, color: c.primary, fontFamily: bodyFamily(hi, "semibold") }}>
              {hi ? "बंद करें" : "Close"}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 18, gap: 16, paddingBottom: 40 }}>
          {limitQ.isLoading ? (
            <Body muted style={{ lineHeight: 22 }}>
              {hi ? "सीमा लोड हो रही है…" : "Loading your award limit…"}
            </Body>
          ) : limitQ.isError ? (
            <Body style={{ color: c.destructive, lineHeight: 22 }}>
              {hi
                ? "सीमा लोड नहीं हुई — पुनः खोलकर कोशिश करें।"
                : "Could not load award limits — close and try again."}
            </Body>
          ) : null}

          {/* H6 — which of BRD 7.2's categories, so the ledger records what
              the award was FOR instead of one bucket plus free text. */}
          {categories.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
                {hi ? "किसलिए?" : "What is this for?"}
              </Body>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {categories.map((cat) => {
                  const active = cat.key === categoryKey;
                  return (
                    <Pressable
                      key={cat.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={cat.label}
                      onPress={() => {
                        setCategoryKey(cat.key);
                        if (cat.default_points != null) {
                          setPoints(Math.min(cat.default_points, effectiveMax));
                        }
                      }}
                      style={{
                        borderWidth: 1,
                        borderColor: active ? c.primary : c.border,
                        backgroundColor: active ? c.accent : c.card,
                        borderRadius: c.radius,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          lineHeight: 22,
                          color: active ? c.primary : c.foreground,
                          fontFamily: bodyFamily(hi, active ? "semibold" : "regular"),
                        }}
                      >
                        {cat.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {category?.min_points != null && category.min_points > 0 ? (
                <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
                  {hi
                    ? `${category.label}: ${category.min_points}–${category.max_points ?? ""} अंक`
                    : `${category.label}: ${category.min_points}–${category.max_points ?? ""} Punya`}
                </Body>
              ) : null}
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
              {hi ? "अंक" : "Points"}
              {maxPerAward > 0
                ? hi
                  ? ` (अधिकतम ${effectiveMax})`
                  : ` (max ${effectiveMax})`
                : ""}
            </Body>
            <Row style={{ alignItems: "center", gap: 12 }}>
              <Pressable
                onPress={() => addPoints(-1)}
                disabled={points <= 0 || award.isPending}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: c.radius,
                  borderWidth: 1,
                  borderColor: c.border,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: c.card,
                  opacity: points <= 0 ? 0.4 : 1,
                }}
              >
                <Text style={{ fontSize: 22, color: c.foreground }}>−</Text>
              </Pressable>
              <Numeric style={{ fontSize: 36, minWidth: 48, textAlign: "center" }}>{points}</Numeric>
              <Pressable
                onPress={() => addPoints(1)}
                disabled={points >= effectiveMax || award.isPending}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: c.radius,
                  borderWidth: 1,
                  borderColor: c.border,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: c.card,
                  opacity: points >= effectiveMax ? 0.4 : 1,
                }}
              >
                <Text style={{ fontSize: 22, color: c.foreground }}>+</Text>
              </Pressable>
            </Row>
            <Row style={{ flexWrap: "wrap", gap: 8 }}>
              {[1, 2, 5].map((n) => {
                const disabled = n > effectiveMax || award.isPending;
                return (
                  <Pressable
                    key={n}
                    onPress={() => addPoints(n)}
                    disabled={disabled}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: c.radius,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.muted,
                      opacity: disabled ? 0.4 : 1,
                    }}
                  >
                    <Body style={{ fontFamily: bodyFamily(hi, "semibold"), lineHeight: 22 }}>
                      +{n}
                    </Body>
                  </Pressable>
                );
              })}
            </Row>
          </View>

          <View style={{ gap: 8 }}>
            <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
              {hi ? "कारण *" : "Reason *"}
            </Body>
            <Row style={{ flexWrap: "wrap", gap: 8 }}>
              {REASON_PRESETS.map((p) => {
                const label = hi ? p.hi ?? p.en : p.en;
                const active = reason === label;
                return (
                  <Pressable
                    key={p.en}
                    onPress={() => setReason(label)}
                    disabled={award.isPending}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: c.radius,
                      borderWidth: 1,
                      borderColor: active ? c.primary : c.border,
                      backgroundColor: active ? c.primary + "14" : c.card,
                    }}
                  >
                    <Body
                      style={{
                        fontSize: 13,
                        lineHeight: 22,
                        color: active ? c.primary : c.foreground,
                      }}
                    >
                      {label}
                    </Body>
                  </Pressable>
                );
              })}
            </Row>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder={hi ? "कम से कम 3 अक्षर" : "At least 3 characters"}
              placeholderTextColor={c.mutedForeground}
              editable={!award.isPending}
              multiline
              style={[fieldStyle, { minHeight: 72, textAlignVertical: "top" }]}
            />
          </View>

          {maxPerDay != null && remainingToday != null ? (
            <Body muted style={{ fontSize: 13, lineHeight: 22 }}>
              {hi
                ? `आज आप ${remainingToday} और दे सकते हैं`
                : `You can award ${remainingToday} more today`}
            </Body>
          ) : null}

          {formError ? (
            <Body style={{ color: c.destructive, lineHeight: 22 }}>{formError}</Body>
          ) : null}

          <Button
            label={hi ? "पुष्टि करें" : "Confirm"}
            onPress={submit}
            loading={award.isPending}
            disabled={confirmDisabled}
          />
        </ScrollView>
      </ActivityThemed>
    </Modal>
  );
}

function HomeworkPanel({ studentId }: { studentId: string }) {
  const c = useColors();
  const { hi } = useLocale();
  const list = useStudentHomeworkHistory(studentId, true);
  const rows = list.data?.items ?? [];

  if (list.isLoading) return <StateView status="loading" emptyText="" />;
  if (list.isError) {
    return (
      <StateView
        status="error"
        emptyText=""
        errorText={hi ? "गृहकार्य लोड नहीं हुआ।" : "Could not load homework."}
        onRetry={list.refetch}
        retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
      />
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <Button
        label={hi ? "सभी गृहकार्य" : "All homework"}
        variant="outline"
        onPress={() => router.push("/shikshak/homework" as never)}
      />
      {rows.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "अभी कोई गृहकार्य नहीं।" : "No homework history yet."}
        />
      ) : (
        rows.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => router.push(`/homework-assignment/${r.assignment_id}` as never)}
          >
            <Card>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <Title style={{ fontSize: 16, flex: 1, paddingRight: 8 }}>{r.title}</Title>
                <Pill label={recordStatusLabel(r.status, hi)} tone={homeworkTone(r.status)} />
              </Row>
              <Body muted style={{ fontSize: 12, marginTop: 6 }}>
                {hi ? "नियत" : "Due"}: {formatDate(r.due_date)}
                {r.batch_name ? ` · ${r.batch_name}` : ""}
              </Body>
              {r.overdue ? (
                <Pill tone="error" label={hi ? "अतिदेय" : "Overdue"} />
              ) : r.late ? (
                <Pill tone="warning" label={hi ? "विलंबित" : "Late"} />
              ) : null}
              {r.feedback_note ? (
                <Body muted style={{ fontSize: 12, marginTop: 6 }}>
                  {r.feedback_note}
                </Body>
              ) : null}
              <Body style={{ fontSize: 12, marginTop: 8, color: c.primary }}>
                {hi ? "समीक्षा खोलें" : "Open review"}
              </Body>
            </Card>
          </Pressable>
        ))
      )}
    </View>
  );
}

function NiyamPanel({ studentId }: { studentId: string }) {
  const c = useColors();
  const { hi } = useLocale();
  const list = useAdminNiyamByStudent(studentId, true);
  const rows = list.data?.items ?? [];

  if (list.isLoading) return <StateView status="loading" emptyText="" />;
  if (list.isError) {
    return (
      <StateView
        status="error"
        emptyText=""
        errorText={hi ? "नियम लोड नहीं हुए।" : "Could not load Niyam history."}
        onRetry={list.refetch}
        retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
      />
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <Button
        label={hi ? "नियम समीक्षा खोलें" : "Open Niyam review"}
        onPress={() =>
          router.push({
            pathname: "/shikshak/niyam-review",
            params: { student_id: studentId },
          } as never)
        }
      />
      {rows.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "अभी कोई नियम प्रस्तुति नहीं।" : "No Niyam submissions yet."}
        />
      ) : (
        rows.map((r) => (
          <Pressable
            key={r.id}
            onPress={() =>
              router.push({
                pathname: "/shikshak/niyam-review",
                params: { student_id: studentId },
              } as never)
            }
          >
            <Card>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <Title style={{ fontSize: 16, flex: 1, paddingRight: 8 }}>
                  {hi ? r.niyam_title_hi || r.niyam_title_en : r.niyam_title_en}
                </Title>
                <Pill
                  label={recordStatusLabel(r.status, hi)}
                  tone={r.status === "approved" ? "success" : "neutral"}
                />
              </Row>
              <Body muted style={{ fontSize: 12, marginTop: 6 }}>
                {formatDate(r.submission_date)}
                {r.points_awarded != null ? ` · +${r.points_awarded}` : ""}
              </Body>
              <Body style={{ fontSize: 12, marginTop: 8, color: c.primary }}>
                {hi ? "समीक्षा खोलें" : "Open review"}
              </Body>
            </Card>
          </Pressable>
        ))
      )}
    </View>
  );
}

function ProgressPanel({ studentId, studentName }: { studentId: string; studentName?: string }) {
  const { hi } = useLocale();
  const { user } = useAuth();
  const qs = new URLSearchParams({ student_id: studentId });
  if (studentName?.trim()) qs.set("student_name", studentName.trim());
  const coursesHref =
    (user?.role === "shikshak" ? "/shikshak/courses" : "/admin/courses") + `?${qs.toString()}`;

  return (
    <View style={{ gap: 12 }}>
      <Body muted style={{ lineHeight: 22 }}>
        {hi
          ? "पाठ्यक्रम सूची इस विद्यार्थी को चुने हुए रखेगी — प्रगति एक टैप में।"
          : "Courses will keep this student selected — Progress opens in one tap."}
      </Body>
      <Button
        label={hi ? "पाठ्यक्रम खोलें" : "Open courses"}
        onPress={() => router.push(coursesHref as never)}
      />
    </View>
  );
}

export default function StudentDetailScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string; section?: string; name?: string }>();
  const studentId = typeof params.id === "string" ? params.id : "";
  const sectionParam = typeof params.section === "string" ? params.section : "";
  const nameParam =
    typeof params.name === "string" ? params.name.trim() : Array.isArray(params.name) ? String(params.name[0] ?? "").trim() : "";
  const [section, setSection] = useState<SectionKey>(() =>
    SECTIONS.some((s) => s.key === sectionParam) ? (sectionParam as SectionKey) : "contact",
  );

  useEffect(() => {
    if (SECTIONS.some((s) => s.key === sectionParam)) {
      setSection(sectionParam as SectionKey);
    }
  }, [sectionParam]);

  const detail = useAdminStudentDetail(studentId || undefined, !!studentId && canAccessAdminPanel(user?.role));
  const titleName = (detail.data?.full_name ?? nameParam).trim() || null;

  const onSectionChange = (key: SectionKey) => {
    setSection(key);
    router.setParams({ section: key });
  };

  if (!canAccessAdminPanel(user?.role)) {
    return (
      <ActivityThemed accent="students">
        <AppHeader title={hi ? "विद्यार्थी" : "Student"} />
        <StateView
          status="error"
          emptyText=""
          errorText={
            hi
              ? "यह स्क्रीन गुरुजी और व्यवस्थापकों के लिए है।"
              : "This screen is for Guruji and admin roles."
          }
        />
      </ActivityThemed>
    );
  }

  if (!studentId) {
    return (
      <ActivityThemed accent="students">
        <AppHeader title={hi ? "विद्यार्थी" : "Student"} />
        <StateView status="empty" emptyText={hi ? "विद्यार्थी नहीं मिला।" : "Student not found."} />
      </ActivityThemed>
    );
  }

  return (
    <ActivityThemed accent="students">
      <AppHeader
        title={titleName ?? (detail.isLoading ? (hi ? "लोड हो रहा है…" : "Loading…") : hi ? "विद्यार्थी" : "Student")}
        subtitle={detail.data?.student_code ?? undefined}
        compact
      />
      <SectionChips active={section} onChange={onSectionChange} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {section === "contact" ? <ContactPanel studentId={studentId} /> : null}
        {section === "idcard" ? <IdCardPanel studentId={studentId} /> : null}
        {section === "attendance" ? <AttendancePanel studentId={studentId} /> : null}
        {section === "punya" ? <PunyaPanel studentId={studentId} /> : null}
        {section === "homework" ? <HomeworkPanel studentId={studentId} /> : null}
        {section === "niyam" ? <NiyamPanel studentId={studentId} /> : null}
        {section === "progress" ? (
          <ProgressPanel studentId={studentId} studentName={titleName ?? undefined} />
        ) : null}
      </ScrollView>
    </ActivityThemed>
  );
}
