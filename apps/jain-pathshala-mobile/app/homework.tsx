import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useHomework, useSubmitHomework } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { bodyFamily } from "@/constants/typography";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

type Tone = "success" | "warning" | "error" | "info" | "primary" | "neutral";

/** Map a homework status to a Pill tone. `late` is surfaced as a separate pill. */
function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (s === "approved") return "success";
  if (s === "starred") return "primary";
  if (s === "submitted") return "info";
  if (s === "pending") return "warning";
  if (s === "late") return "error";
  return "neutral";
}

function statusLabel(status: string, hi: boolean): string {
  const s = status.toLowerCase();
  if (s === "approved") return hi ? "स्वीकृत" : "Approved";
  if (s === "starred") return hi ? "विशेष" : "Starred";
  if (s === "submitted") return hi ? "प्रस्तुत" : "Submitted";
  if (s === "pending") return hi ? "लंबित" : "Pending";
  if (s === "late") return hi ? "विलंबित" : "Late";
  return status;
}

/** Inline "submit work" form shown for items not yet approved/starred. */
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
  const [url, setUrl] = useState("");
  const submit = useSubmitHomework();

  if (!open) {
    return (
      <Row style={{ marginTop: 12 }}>
        <Button
          label={hi ? "कार्य प्रस्तुत करें" : "Submit work"}
          variant="outline"
          icon="cloud-upload-outline"
          onPress={() => setOpen(true)}
        />
      </Row>
    );
  }

  const trimmed = url.trim();
  return (
    <View style={{ marginTop: 12, gap: 10 }}>
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
                  setOpen(false);
                  // §8 vocabulary: enqueue always lands as queued; drain may move
                  // it to syncing/synced/duplicate/conflict/failed asynchronously.
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
            setOpen(false);
          }}
        />
      </Row>
    </View>
  );
}

export default function HomeworkScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const homework = useHomework(activeStudentId ?? undefined);
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
          <ChildSwitcher />
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
          emptyText={hi ? "अभी कोई गृहकार्य नहीं है।" : "No homework assigned yet."}
        />
      ) : (
        rows.map((row) => {
          const status = row.status.toLowerCase();
          const canSubmit = status !== "approved" && status !== "starred";
          return (
            <Card key={row.id}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Title style={{ fontSize: 16 }}>{row.title}</Title>
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

              {row.submission_url ? (
                <Body
                  muted
                  numberOfLines={1}
                  style={{ marginTop: 10, fontSize: 13, color: c.infoText }}
                >
                  {row.submission_url}
                </Body>
              ) : null}

              {row.feedback_note ? (
                <View
                  style={{
                    marginTop: 12,
                    backgroundColor: c.muted,
                    borderRadius: c.radius,
                    padding: 12,
                  }}
                >
                  <Body
                    style={{ fontSize: 11, color: c.mutedForeground, marginBottom: 2 }}
                  >
                    {hi ? "प्रतिक्रिया" : "Feedback"}
                  </Body>
                  <Body style={{ fontSize: 14 }}>{row.feedback_note}</Body>
                </View>
              ) : null}

              {canSubmit ? (
                <SubmitForm
                  assignmentId={row.assignment_id}
                  submissionId={row.id}
                  studentId={activeStudentId}
                />
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
