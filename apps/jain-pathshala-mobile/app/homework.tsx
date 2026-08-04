import { useState } from "react";
import { Alert, Linking, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useHomework, useSubmitHomework, useMarkHomeworkDone } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { bodyFamily } from "@/constants/typography";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { HomeworkProofPicker } from "@/components/HomeworkProofPicker";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

type Tone = "success" | "warning" | "error" | "info" | "primary" | "neutral";

/** Map a homework status to a Pill tone. `late` is surfaced as a separate pill. */
function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (s === "approved") return "success";
  if (s === "starred") return "primary";
  if (s === "submitted" || s === "acknowledged") return "info";
  if (s === "pending") return "warning";
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

/** Inline "submit work" form — photo/file primary, URL secondary. */
function SubmitForm({
  assignmentId,
  submissionId,
  studentId,
}: {
  assignmentId: string;
  submissionId: string;
  studentId: string;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const [open, setOpen] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const submit = useSubmitHomework();

  if (!open) {
    return (
      <Button
        label={hi ? "कार्य प्रस्तुत करें" : "Submit work"}
        variant="outline"
        icon="cloud-upload-outline"
        onPress={() => setOpen(true)}
      />
    );
  }

  const trimmed = url.trim();
  return (
    <View style={{ marginTop: 12, gap: 12 }}>
      <HomeworkProofPicker
        assignmentId={assignmentId}
        submissionId={submissionId}
        studentId={studentId}
        disabled={submit.isPending}
        onQueued={() => {
          setOpen(false);
          setShowUrl(false);
          setUrl("");
          Alert.alert(
            hi ? "ऑफ़लाइन सहेजा गया" : "Saved offline",
            hi
              ? "आपका गृहकार्य सहेज लिया गया है और समन्वयित होगा।"
              : "Your homework was saved and will sync.",
          );
        }}
      />

      {!showUrl ? (
        <Button
          label={hi ? "लिंक से प्रस्तुत करें" : "Submit with a link instead"}
          variant="ghost"
          disabled={submit.isPending}
          onPress={() => setShowUrl(true)}
        />
      ) : (
        <View style={{ gap: 10 }}>
          <Body muted style={{ fontSize: 12 }}>
            {hi
              ? "यदि गुरुजी ने कोई लिंक साझा किया हो"
              : "If your Guruji shared a link"}
          </Body>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder={hi ? "कार्य का लिंक (URL)" : "Link to your work (URL)"}
            placeholderTextColor={c.inkDim}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!submit.isPending}
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 15,
              color: c.foreground,
              backgroundColor: c.background,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: c.radius,
              paddingHorizontal: 14,
              paddingVertical: 11,
            }}
          />
          <Row style={{ gap: 10 }}>
            <Button
              label={hi ? "भेजें" : "Send"}
              icon="checkmark"
              loading={submit.isPending}
              disabled={!trimmed}
              style={{ flex: 1 }}
              onPress={() =>
                submit.mutate(
                  {
                    assignmentId,
                    submissionId,
                    studentId,
                    submission_url: trimmed,
                  },
                  {
                    onSuccess: (res) => {
                      setUrl("");
                      setShowUrl(false);
                      setOpen(false);
                      if (res.queued) {
                        Alert.alert(
                          hi ? "ऑफ़लाइन सहेजा गया" : "Saved offline",
                          hi
                            ? "आपका गृहकार्य सहेज लिया गया है और समन्वयित होगा।"
                            : "Your homework was saved and will sync.",
                        );
                      }
                    },
                    onError: (err) => {
                      Alert.alert(
                        hi ? "सहेजा नहीं जा सका" : "Could not save",
                        err instanceof Error
                          ? err.message
                          : hi
                            ? "फिर से प्रयास करें।"
                            : "Please try again.",
                      );
                    },
                  },
                )
              }
            />
            <Button
              label={hi ? "रद्द करें" : "Cancel"}
              variant="ghost"
              disabled={submit.isPending}
              onPress={() => {
                setUrl("");
                setShowUrl(false);
              }}
            />
          </Row>
        </View>
      )}

      <Button
        label={hi ? "बंद करें" : "Close"}
        variant="ghost"
        disabled={submit.isPending}
        onPress={() => {
          setUrl("");
          setShowUrl(false);
          setOpen(false);
        }}
      />
    </View>
  );
}

/** Mark-done without an upload — for recitation / reading work with no artefact (F1). */
function MarkDoneButton({
  submissionId,
  studentId,
}: {
  submissionId: string;
  studentId: string;
}) {
  const { hi } = useLocale();
  const markDone = useMarkHomeworkDone();

  return (
    <Button
      label={hi ? "पूर्ण बताएँ" : "Mark as done"}
      variant="ghost"
      icon="checkmark-circle-outline"
      loading={markDone.isPending}
      disabled={markDone.isPending}
      onPress={() =>
        markDone.mutate(
          { submissionId, studentId },
          {
            onSuccess: () => {
              Alert.alert(
                hi ? "पूर्ण बताया" : "Marked done",
                hi
                  ? "गुरुजी को बता दिया गया है कि कार्य पूरा हो गया।"
                  : "Guruji will see that the work is done.",
              );
            },
            onError: (err) => {
              Alert.alert(
                hi ? "सहेजा नहीं जा सका" : "Could not save",
                err instanceof Error
                  ? err.message
                  : hi
                    ? "फिर से प्रयास करें।"
                    : "Please try again.",
              );
            },
          },
        )
      }
    />
  );
}

export default function HomeworkScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, children, loading, refetch, setActiveStudentId } =
    useSessionView();
  const [allChildren, setAllChildren] = useState(false);

  const homework = useHomework(allChildren ? null : activeStudentId, {
    allChildren,
  });
  const rows = homework.data?.items ?? [];

  return (
    <Screen
      refreshing={homework.isRefetching}
      onRefresh={() => {
        refetch();
        homework.refetch();
      }}
    >
      <Title style={{ fontSize: 22 }}>{hi ? "गृहकार्य" : "Homework"}</Title>
      <Body muted style={{ marginTop: -4 }}>
        {hi ? "आपके सौंपे गए कार्य और प्रस्तुतियाँ" : "Your assigned work and submissions"}
      </Body>

      {/* canonical state ladder: session-loading -> no-child -> query-loading -> error -> empty -> data */}
      {loading ? (
        <StateView status="loading" emptyText="" />
      ) : !activeStudentId || !activeChild ? (
        <StateView
          status="empty"
          emptyText={
            hi
              ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।"
              : "Your student profile isn't ready yet."
          }
        />
      ) : (
        <>
          <ChildSwitcher
            includeAll={children.length > 1}
            allSelected={allChildren}
            onSelectAll={() => setAllChildren(true)}
            onSelectChild={(id) => {
              setAllChildren(false);
              setActiveStudentId(id);
            }}
          />
          {homework.isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : homework.isError ? (
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "गृहकार्य लोड नहीं हुआ।" : "Could not load homework."}
          onRetry={homework.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      ) : rows.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "अभी कोई गृहकार्य नहीं है。" : "No homework assigned yet."}
        />
      ) : (
        rows.map((row) => {
          const status = row.status.toLowerCase();
          const canSubmit = status !== "approved" && status !== "starred";
          const canMarkDone = status === "pending" || status === "returned";
          const rowStudentId = row.student_id ?? activeStudentId;
          return (
            <Card key={row.id}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  {allChildren && row.student_name ? (
                    <Body muted style={{ fontSize: 12, marginBottom: 2 }}>
                      {row.student_name}
                    </Body>
                  ) : null}
                  <Title style={{ fontSize: 16 }}>{row.title}</Title>
                  {(hi ? row.curriculum_topic_hi : row.curriculum_topic_en) ? (
                    <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                      {hi ? row.curriculum_topic_hi : row.curriculum_topic_en}
                    </Body>
                  ) : null}
                  <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                    {hi ? "नियत तिथि: " : "Due: "}
                    {formatDate(row.due_date)}
                  </Body>
                </View>
                <Pill label={statusLabel(row.status, hi)} tone={statusTone(row.status)} />
              </Row>

              {row.late ? (
                <Row style={{ marginTop: 10 }}>
                  <Pill label={hi ? "विलंबित" : "Late"} tone="error" />
                </Row>
              ) : null}

              {row.overdue ? (
                <Row style={{ marginTop: 10 }}>
                  <Pill label={hi ? "समय समाप्त" : "Overdue"} tone="error" />
                </Row>
              ) : null}

              {row.attachment_url ? (
                <Button
                  label={hi ? "कार्यपत्रक खोलें" : "Open worksheet"}
                  variant="outline"
                  icon="document-outline"
                  style={{ marginTop: 10 }}
                  onPress={() => {
                    void Linking.openURL(row.attachment_url!).catch(() => {
                      Alert.alert(
                        hi ? "खोल नहीं सके" : "Could not open",
                        hi
                          ? "कार्यपत्रक लिंक काम नहीं कर रहा — गुरुजी से पूछें।"
                          : "That worksheet link could not be opened — ask your Guruji.",
                      );
                    });
                  }}
                />
              ) : null}

              {row.submission_url ? (
                <Button
                  label={hi ? "प्रस्तुत कार्य देखें" : "View your submission"}
                  variant="ghost"
                  icon="link-outline"
                  style={{ marginTop: 4 }}
                  onPress={() => {
                    void Linking.openURL(row.submission_url!).catch(() => {
                      Alert.alert(
                        hi ? "खोल नहीं सके" : "Could not open",
                        hi ? "लिंक काम नहीं कर रहा।" : "That link could not be opened.",
                      );
                    });
                  }}
                />
              ) : null}

              {row.feedback_note ? (
                <View
                  style={{
                    marginTop: 12,
                    backgroundColor: status === "returned" ? c.warningSoft : c.muted,
                    borderRadius: c.radius,
                    padding: 12,
                    ...(status === "returned"
                      ? { borderWidth: 1, borderColor: c.warningText }
                      : {}),
                  }}
                >
                  <Body
                    style={{
                      fontSize: 11,
                      color: status === "returned" ? c.warningText : c.mutedForeground,
                      marginBottom: 2,
                    }}
                  >
                    {hi ? "प्रतिक्रिया" : "Feedback"}
                  </Body>
                  <Body style={{ fontSize: 14 }}>{row.feedback_note}</Body>
                </View>
              ) : null}

              {canSubmit ? (
                <View style={{ marginTop: 12, gap: 8 }}>
                  <SubmitForm
                    assignmentId={row.assignment_id}
                    submissionId={row.id}
                    studentId={rowStudentId}
                  />
                  {canMarkDone ? (
                    <MarkDoneButton submissionId={row.id} studentId={rowStudentId} />
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        })
      )}
        </>
      )}
    </Screen>
  );
}
