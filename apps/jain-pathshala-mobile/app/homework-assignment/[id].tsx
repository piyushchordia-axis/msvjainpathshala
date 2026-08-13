/**
 * Shikshak homework assignment detail — review submissions and grade.
 * Pushed from the shikshak Homework tab (same pattern as attendance/[id]).
 */
import { useMemo, useState } from "react";
import { Alert, Linking, Pressable, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { resolveUploadUrl, ApiError } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import {
  useGradeAllHomework,
  useGradeHomeworkSubmission,
  useHomeworkAssignments,
  useHomeworkSubmissions,
  type HomeworkSubmissionAdminRow,
} from "@/lib/queries";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

type Tone = "success" | "warning" | "error" | "info" | "primary" | "neutral";
type SubFilter = "review" | "graded" | "waiting" | "all";

function isImageUploadUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return /\.(jpe?g|png|webp|gif)$/.test(path);
}

function openSubmissionUrl(raw: string | null | undefined, hi: boolean) {
  const url = resolveUploadUrl(raw);
  if (!url) {
    Alert.alert(
      hi ? "खोल नहीं सके" : "Could not open",
      hi ? "लिंक काम नहीं कर रहा।" : "That link could not be opened.",
    );
    return;
  }
  void Linking.openURL(url).catch(() => {
    Alert.alert(
      hi ? "खोल नहीं सके" : "Could not open",
      hi ? "लिंक काम नहीं कर रहा।" : "That link could not be opened.",
    );
  });
}

function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (s === "approved") return "success";
  if (s === "starred") return "primary";
  if (s === "submitted" || s === "acknowledged") return "info";
  if (s === "pending") return "neutral";
  if (s === "late") return "error";
  if (s === "returned") return "warning";
  return "neutral";
}

function statusLabel(status: string, hi: boolean): string {
  const s = status.toLowerCase();
  if (s === "approved") return hi ? "स्वीकृत" : "Approved";
  if (s === "starred") return hi ? "विशेष" : "Starred";
  if (s === "submitted") return hi ? "प्रस्तुत" : "Submitted";
  if (s === "acknowledged") return hi ? "पूर्ण बताया" : "Marked done";
  if (s === "pending") return hi ? "लंबित" : "Pending";
  if (s === "late") return hi ? "विलंबित" : "Late";
  if (s === "returned") return hi ? "पुनः करें" : "Returned";
  return status;
}

function isNeedsReview(status: string): boolean {
  return status === "submitted" || status === "late" || status === "acknowledged";
}

function isGraded(status: string): boolean {
  return status === "approved" || status === "starred";
}

function isWaiting(status: string): boolean {
  return status === "pending" || status === "returned";
}

/** Inline image when the upload is a photo; otherwise a clear Open link. */
function SubmissionWorkPreview({ url, hi }: { url: string; hi: boolean }) {
  const c = useColors();
  const resolved = resolveUploadUrl(url);
  const showImage = Boolean(resolved && isImageUploadUrl(url));

  return (
    <View style={{ marginTop: 10, gap: 8 }}>
      {showImage ? (
        <Pressable
          onPress={() => openSubmissionUrl(url, hi)}
          accessibilityRole="imagebutton"
          accessibilityLabel={hi ? "प्रस्तुत कार्य देखें" : "View submitted work"}
        >
          <Image
            source={{ uri: resolved! }}
            style={{
              width: "100%",
              height: 200,
              borderRadius: c.radius,
              backgroundColor: c.muted,
            }}
            contentFit="contain"
          />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => openSubmissionUrl(url, hi)}
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
        accessibilityRole="link"
        accessibilityLabel={hi ? "प्रस्तुत कार्य खोलें" : "Open submitted work"}
      >
        <Ionicons
          name={showImage ? "open-outline" : "document-attach-outline"}
          size={16}
          color={c.primary}
        />
        <Body style={{ color: c.primary, fontSize: 13 }}>
          {showImage
            ? hi
              ? "पूर्ण आकार में खोलें"
              : "Open full size"
            : hi
              ? "प्रस्तुत कार्य देखें"
              : "Open submitted work"}
        </Body>
      </Pressable>
    </View>
  );
}

function SubmissionCard({
  submission,
  assignmentId,
  onChanged,
}: {
  submission: HomeworkSubmissionAdminRow;
  assignmentId: string;
  onChanged: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const grade = useGradeHomeworkSubmission();
  const [feedback, setFeedback] = useState(submission.feedback_note ?? "");
  const [feedbackEdited, setFeedbackEdited] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const graded = isGraded(submission.status);
  const canGrade = isNeedsReview(submission.status) || graded;
  const canReturn = isNeedsReview(submission.status) || graded;
  const waiting = isWaiting(submission.status);

  function doGrade(status: "approved" | "starred" | "returned") {
    if (busy) return;
    if (status === "returned" && !feedback.trim()) {
      Alert.alert(
        hi ? "नोट चाहिए" : "Note required",
        hi
          ? "वापस करने से पहले संक्षिप्त फीडबैक लिखें।"
          : "Add a short note explaining what to fix before returning.",
      );
      return;
    }
    setBusy(status);
    const body: {
      submissionId: string;
      status: "approved" | "starred" | "returned";
      feedback_note?: string | null;
      assignmentId: string;
    } = { submissionId: submission.id, status, assignmentId };
    if (status === "returned" || feedbackEdited) {
      body.feedback_note = feedback.trim() || null;
    }
    grade.mutate(body, {
      onSuccess: () => {
        setFeedbackEdited(false);
        onChanged();
      },
      onError: (e) => {
        Alert.alert(
          hi ? "त्रुटि" : "Could not grade",
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
        );
      },
      onSettled: () => setBusy(null),
    });
  }

  return (
    <Card>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Title style={{ fontSize: 16 }}>{submission.student_name || "—"}</Title>
          <Body muted style={{ fontSize: 12, marginTop: 2 }}>
            {submission.student_code}
          </Body>
        </View>
        <Pill tone={statusTone(submission.status)} label={statusLabel(submission.status, hi)} />
      </Row>

      {submission.late ? (
        <View style={{ marginTop: 8 }}>
          <Pill tone="error" label={hi ? "विलंब से" : "Late"} />
        </View>
      ) : null}

      {submission.submission_url ? (
        <SubmissionWorkPreview url={submission.submission_url} hi={hi} />
      ) : isNeedsReview(submission.status) ? (
        <Body muted style={{ marginTop: 10, fontSize: 12 }}>
          {hi ? "पूर्ण बताया — कोई फ़ाइल नहीं।" : "Marked done — no file attached."}
        </Body>
      ) : null}

      {submission.feedback_note && !canGrade ? (
        <Body muted style={{ marginTop: 10, fontSize: 13 }}>
          {submission.feedback_note}
        </Body>
      ) : null}

      {waiting ? (
        <Body muted style={{ marginTop: 10, fontSize: 12 }}>
          {submission.status === "returned"
            ? hi
              ? "पुनः प्रस्तुति की प्रतीक्षा।"
              : "Waiting for resubmission."
            : hi
              ? "अभी प्रस्तुत नहीं किया।"
              : "Not submitted yet."}
        </Body>
      ) : null}

      {canGrade ? (
        <View style={{ marginTop: 12, gap: 10 }}>
          <TextInput
            value={feedback}
            onChangeText={(t) => {
              setFeedback(t);
              setFeedbackEdited(true);
            }}
            placeholder={
              canReturn
                ? hi
                  ? "फीडबैक (वापस करने के लिए आवश्यक)"
                  : "Feedback (required to return)"
                : hi
                  ? "फीडबैक (वैकल्पिक)"
                  : "Feedback (optional)"
            }
            placeholderTextColor={c.mutedForeground}
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 14,
              color: c.foreground,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: c.radius,
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: c.card,
            }}
          />
          <Row style={{ gap: 8, flexWrap: "wrap" }}>
            <Button
              label={busy === "approved" ? "…" : hi ? "स्वीकृत" : "Approve"}
              variant="secondary"
              disabled={!!busy}
              onPress={() => doGrade("approved")}
              style={{ paddingVertical: 10, paddingHorizontal: 14 } as never}
            />
            <Button
              label={busy === "starred" ? "…" : hi ? "विशेष" : "Star"}
              disabled={!!busy}
              onPress={() => doGrade("starred")}
              style={{ paddingVertical: 10, paddingHorizontal: 14 } as never}
            />
            {canReturn ? (
              <Button
                label={busy === "returned" ? "…" : hi ? "वापस" : "Return"}
                variant="outline"
                disabled={!!busy}
                onPress={() => doGrade("returned")}
                style={{ paddingVertical: 10, paddingHorizontal: 14 } as never}
              />
            ) : null}
          </Row>
        </View>
      ) : null}
    </Card>
  );
}

export default function HomeworkAssignmentScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const assignmentId = typeof id === "string" ? id : Array.isArray(id) ? id[0] : undefined;

  const assignments = useHomeworkAssignments();
  const submissions = useHomeworkSubmissions(assignmentId);
  const gradeAll = useGradeAllHomework();
  const [filter, setFilter] = useState<SubFilter>("review");

  const assignment = useMemo(
    () => (assignments.data?.items ?? []).find((a) => a.id === assignmentId) ?? null,
    [assignments.data?.items, assignmentId],
  );

  const items = submissions.data?.items ?? [];

  const buckets = useMemo(() => {
    const review: HomeworkSubmissionAdminRow[] = [];
    const graded: HomeworkSubmissionAdminRow[] = [];
    const waiting: HomeworkSubmissionAdminRow[] = [];
    for (const s of items) {
      if (isNeedsReview(s.status)) review.push(s);
      else if (isGraded(s.status)) graded.push(s);
      else waiting.push(s);
    }
    return { review, graded, waiting };
  }, [items]);

  const gradeable = buckets.review;

  const visible = useMemo(() => {
    if (filter === "review") return buckets.review;
    if (filter === "graded") return buckets.graded;
    if (filter === "waiting") return buckets.waiting;
    return [...buckets.review, ...buckets.graded, ...buckets.waiting];
  }, [filter, buckets]);

  function confirmGradeAll() {
    if (!assignmentId || gradeable.length === 0) {
      Alert.alert(
        hi ? "कुछ नहीं" : "Nothing to approve",
        hi ? "स्वीकृत करने योग्य प्रस्तुति नहीं है।" : "No submissions are ready to approve.",
      );
      return;
    }
    Alert.alert(
      hi ? "सभी स्वीकृत करें?" : "Approve all ready?",
      hi
        ? `${gradeable.length} प्रस्तुति(याँ) स्वीकृत होंगी।`
        : `${gradeable.length} submission(s) will be approved.`,
      [
        { text: hi ? "रद्द" : "Cancel", style: "cancel" },
        {
          text: hi ? "स्वीकृत करें" : "Approve",
          onPress: () => {
            gradeAll.mutate(
              { assignmentId, work_kind: "all" },
              {
                onSuccess: (res) => {
                  Alert.alert(
                    hi ? "हो गया" : "Done",
                    hi
                      ? `${res.summary.graded} स्वीकृत।`
                      : `${res.summary.graded} approved.`,
                  );
                  void submissions.refetch();
                  void assignments.refetch();
                },
                onError: (e) => {
                  Alert.alert(
                    hi ? "त्रुटि" : "Error",
                    e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
                  );
                },
              },
            );
          },
        },
      ],
    );
  }

  if (!assignmentId) {
    return (
      <ActivityThemed accent="homework">
      <Screen scroll={false}>
        <StateView status="error" emptyText="" errorText={hi ? "अमान्य असाइनमेंट।" : "Invalid assignment."} />
      </Screen>
      </ActivityThemed>
    );
  }

  const filters: { key: SubFilter; en: string; hiLabel: string; count: number }[] = [
    { key: "review", en: "To review", hiLabel: "जाँचें", count: buckets.review.length },
    { key: "graded", en: "Graded", hiLabel: "जाँचे", count: buckets.graded.length },
    { key: "waiting", en: "Waiting", hiLabel: "प्रतीक्षा", count: buckets.waiting.length },
    { key: "all", en: "All", hiLabel: "सभी", count: items.length },
  ];

  return (
    <ActivityThemed accent="homework">
    <Screen
      refreshing={submissions.isRefetching}
      onRefresh={() => {
        void submissions.refetch();
        void assignments.refetch();
      }}
    >
      {assignment ? (
        <Card>
          <Title style={{ fontSize: 18 }}>{assignment.title}</Title>
          <Body muted style={{ marginTop: 6, fontSize: 13 }}>
            {[assignment.batch_name, assignment.centre_name].filter(Boolean).join(" · ")}
          </Body>
          {assignment.description ? (
            <Body style={{ marginTop: 10, fontSize: 14 }}>{assignment.description}</Body>
          ) : null}
          <Row style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
            <Pill
              tone="info"
              label={
                hi
                  ? `${assignment.submitted}/${assignment.total} प्रस्तुत`
                  : `${assignment.submitted}/${assignment.total} submitted`
              }
            />
            <Pill
              tone="success"
              label={hi ? `${assignment.graded} जाँचे` : `${assignment.graded} graded`}
            />
          </Row>
        </Card>
      ) : null}

      <Row style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {filters.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={{
                backgroundColor: active ? c.primary : c.muted,
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 7,
              }}
            >
              <Text
                style={{
                  fontFamily: bodyFamily(hi, "semibold"),
                  fontSize: 12,
                  color: active ? c.primaryForeground : c.mutedForeground,
                }}
              >
                {hi ? f.hiLabel : f.en} ({f.count})
              </Text>
            </Pressable>
          );
        })}
      </Row>

      {filter === "review" && gradeable.length > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <Button
            label={
              gradeAll.isPending
                ? hi
                  ? "स्वीकृत हो रहा…"
                  : "Approving…"
                : hi
                  ? `तैयार स्वीकृत करें (${gradeable.length})`
                  : `Approve ready (${gradeable.length})`
            }
            variant="outline"
            loading={gradeAll.isPending}
            onPress={confirmGradeAll}
          />
        </View>
      ) : null}

      {submissions.isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : submissions.isError ? (
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "प्रस्तुतियाँ लोड नहीं हुईं।" : "Could not load submissions."}
          onRetry={submissions.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      ) : visible.length === 0 ? (
        <StateView
          status="empty"
          emptyText={
            filter === "review"
              ? hi
                ? "अभी कोई प्रस्तुत कार्य जाँच के लिए नहीं है।"
                : "No submitted work waiting for review."
              : filter === "graded"
                ? hi
                  ? "अभी कोई जाँचा हुआ कार्य नहीं।"
                  : "No graded submissions yet."
                : filter === "waiting"
                  ? hi
                    ? "सभी विद्यार्थियों ने प्रस्तुत कर दिया है।"
                    : "No students still waiting to submit."
                  : hi
                    ? "इस असाइनमेंट पर कोई विद्यार्थी नहीं।"
                    : "No students on this assignment."
          }
        />
      ) : (
        visible.map((s) => (
          <SubmissionCard
            key={s.id}
            submission={s}
            assignmentId={assignmentId}
            onChanged={() => {
              void submissions.refetch();
              void assignments.refetch();
            }}
          />
        ))
      )}
    </Screen>
    </ActivityThemed>
  );
}
