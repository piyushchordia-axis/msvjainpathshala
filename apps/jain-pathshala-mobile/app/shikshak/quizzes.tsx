/**
 * H17 — the Guruji's push-quiz screen.
 *
 * SPEC §15.2 describes a push quiz as an "instant quiz created on-the-fly by
 * Guruji/Didi during a session", and the API has always admitted a shikshak to
 * POST /push (the handler even stamps shikshak_user_id). But there was no UI on
 * ANY surface: the web nav gates /admin/quizzes at city_admin, and mobile had
 * /quizzes only in PARENT_ACTIONS. The persona the feature was designed for
 * could not reach it.
 *
 * Mobile rather than web, deliberately: a Guruji mid-class is holding a phone,
 * not sitting at a laptop.
 *
 * H12 — the correction path lives here too: end a quiz early, and reset an
 * attempt (reversing its Punya) when a child was graded against a wrong key.
 * Scheduled events had all of this; push quizzes had none of it.
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { bodyFamily } from "@/constants/typography";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { apiErrorMessage } from "@/lib/api-error-copy";
import {
  useAdminBatches,
  useMyPushQuizzes,
  usePushQuizRoster,
  useStartPushQuiz,
  useEndPushQuiz,
  useResetPushQuizAttempt,
  type PushQuizAttemptRow,
  type ShikshakPushQuizRow,
} from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

/** Shared with the other shikshak screens so the batch choice follows them. */
const BATCH_KEY = "jp.shikshak.selectedBatchId";

const DURATION_CHOICES = [5, 10, 15, 30] as const;

interface DraftOption {
  text_en: string;
  text_hi: string;
}

interface DraftQuestion {
  question_en: string;
  question_hi: string;
  options: DraftOption[];
  correct: boolean[];
}

function emptyQuestion(): DraftQuestion {
  return {
    question_en: "",
    question_hi: "",
    options: [
      { text_en: "", text_hi: "" },
      { text_en: "", text_hi: "" },
    ],
    correct: [false, false],
  };
}

/**
 * C2 in miniature — the indices must reference the array actually sent. The web
 * editor shipped a version that indexed the UNFILTERED draft and silently
 * shifted the answer key; blanks are refused here rather than dropped.
 */
function draftError(q: DraftQuestion, hi: boolean): string | null {
  if (!q.question_en.trim()) {
    return hi ? "प्रश्न लिखें।" : "Write the question.";
  }
  const blank = q.options.findIndex((o) => !o.text_en.trim());
  if (blank >= 0) {
    return hi
      ? `विकल्प ${blank + 1} खाली है — भरें या हटाएँ।`
      : `Option ${blank + 1} is empty — fill it in or remove it.`;
  }
  if (!q.correct.some(Boolean)) {
    return hi ? "कम से कम एक सही उत्तर चुनें।" : "Mark at least one correct answer.";
  }
  return null;
}

function draftToPayload(q: DraftQuestion) {
  return {
    question_en: q.question_en.trim(),
    ...(q.question_hi.trim() ? { question_hi: q.question_hi.trim() } : {}),
    options: q.options.map((o) => ({
      text_en: o.text_en.trim(),
      ...(o.text_hi.trim() ? { text_hi: o.text_hi.trim() } : {}),
    })),
    correct_indices: q.correct.map((c, i) => (c ? i : -1)).filter((i) => i >= 0),
  };
}

function minutesLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000));
}

/** Labelled text field — the shared ui module has no Input primitive. */
function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  hi,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  hi: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      {label ? (
        <Body muted style={{ fontSize: 12 }}>
          {label}
        </Body>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        multiline={multiline}
        accessibilityLabel={label ?? placeholder}
        style={{
          fontFamily: bodyFamily(hi),
          fontSize: 15,
          // Devanagari ascenders need the taller line box (CLAUDE.md).
          lineHeight: 22,
          color: c.foreground,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: c.radius,
          paddingHorizontal: 14,
          paddingVertical: 10,
          backgroundColor: c.card,
          minHeight: multiline ? 64 : undefined,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}

/* ── Composer ─────────────────────────────────────────────────────────────── */

function QuestionComposer({
  draft,
  onChange,
  hi,
}: {
  draft: DraftQuestion;
  onChange: (d: DraftQuestion) => void;
  hi: boolean;
}) {
  const c = useColors();

  function setOption(i: number, patch: Partial<DraftOption>) {
    onChange({
      ...draft,
      options: draft.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)),
    });
  }

  return (
    <View style={{ gap: 10 }}>
      <TextField
        hi={hi}
        label={hi ? "प्रश्न (अंग्रेज़ी)" : "Question (English)"}
        value={draft.question_en}
        onChangeText={(v) => onChange({ ...draft, question_en: v })}
        multiline
      />
      <TextField
        hi={hi}
        label={hi ? "प्रश्न (हिन्दी)" : "Question (Hindi)"}
        value={draft.question_hi}
        onChangeText={(v) => onChange({ ...draft, question_hi: v })}
        multiline
      />
      <Body muted style={{ fontSize: 12 }}>
        {hi ? "सही उत्तर पर टिक करें" : "Tap the tick to mark the correct answer"}
      </Body>
      {draft.options.map((o, i) => (
        <View key={i} style={{ gap: 6 }}>
          <Row style={{ gap: 8, alignItems: "center" }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!draft.correct[i] }}
              accessibilityLabel={
                hi
                  ? `विकल्प ${i + 1} — सही उत्तर`
                  : `Option ${i + 1} — correct answer`
              }
              onPress={() =>
                onChange({
                  ...draft,
                  correct: draft.correct.map((v, idx) => (idx === i ? !v : v)),
                })
              }
              style={{
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderRadius: c.radius,
                borderColor: draft.correct[i] ? c.primary : c.border,
                backgroundColor: draft.correct[i] ? c.accent : c.card,
              }}
            >
              <Ionicons
                name={draft.correct[i] ? "checkmark-circle" : "ellipse-outline"}
                size={22}
                color={draft.correct[i] ? c.primary : c.inkDim}
              />
            </Pressable>
            <View style={{ flex: 1 }}>
              <TextField
                hi={hi}
                value={o.text_en}
                placeholder={hi ? `विकल्प ${i + 1} (अंग्रेज़ी)` : `Option ${i + 1} (English)`}
                onChangeText={(v) => setOption(i, { text_en: v })}
              />
            </View>
          </Row>
          <TextField
            hi={hi}
            value={o.text_hi}
            placeholder={hi ? `विकल्प ${i + 1} (हिन्दी)` : `Option ${i + 1} (Hindi)`}
            onChangeText={(v) => setOption(i, { text_hi: v })}
          />
        </View>
      ))}
      <Row style={{ gap: 8, flexWrap: "wrap" }}>
        <Button
          label={hi ? "विकल्प जोड़ें" : "Add option"}
          icon="add"
          variant="outline"
          disabled={draft.options.length >= 10}
          onPress={() =>
            onChange({
              ...draft,
              options: [...draft.options, { text_en: "", text_hi: "" }],
              correct: [...draft.correct, false],
            })
          }
        />
        {draft.options.length > 2 ? (
          <Button
            label={hi ? "अंतिम हटाएँ" : "Remove last"}
            icon="remove"
            variant="ghost"
            onPress={() =>
              onChange({
                ...draft,
                options: draft.options.slice(0, -1),
                correct: draft.correct.slice(0, -1),
              })
            }
          />
        ) : null}
      </Row>
      <View style={{ height: 1, backgroundColor: c.border }} />
    </View>
  );
}

/* ── Live roster ──────────────────────────────────────────────────────────── */

function LiveRoster({
  quiz,
  hi,
  onBack,
}: {
  quiz: ShikshakPushQuizRow;
  hi: boolean;
  onBack: () => void;
}) {
  const c = useColors();
  const roster = usePushQuizRoster(quiz.id, quiz.is_live);
  const endQuiz = useEndPushQuiz();
  const resetAttempt = useResetPushQuizAttempt();
  const data = roster.data;

  function confirmEnd() {
    Alert.alert(
      hi ? "अभी समाप्त करें?" : "End this quiz now?",
      hi
        ? "जिन्होंने अभी तक जमा नहीं किया, वे और उत्तर नहीं दे पाएँगे।"
        : "Students who have not submitted yet will not be able to answer.",
      [
        { text: hi ? "रहने दें" : "Keep it open", style: "cancel" },
        {
          text: hi ? "समाप्त करें" : "End now",
          style: "destructive",
          onPress: () =>
            endQuiz.mutate(quiz.id, {
              onError: (err) =>
                Alert.alert(
                  hi ? "समाप्त नहीं हुआ" : "Couldn't end the quiz",
                  apiErrorMessage(err, hi),
                ),
            }),
        },
      ],
    );
  }

  function confirmReset(row: PushQuizAttemptRow) {
    Alert.alert(
      hi ? "प्रयास रीसेट करें?" : "Reset this attempt?",
      hi
        ? `${row.full_name} के उत्तर हट जाएँगे और ${row.points_awarded} पुण्य वापस ले लिए जाएँगे। वे दोबारा भाग ले सकेंगे।`
        : `${row.full_name}'s answers will be cleared and the ${row.points_awarded} Punya they earned will be reversed. They can then take it again.`,
      [
        { text: hi ? "रहने दें" : "Cancel", style: "cancel" },
        {
          text: hi ? "रीसेट करें" : "Reset",
          style: "destructive",
          onPress: () =>
            resetAttempt.mutate(
              { pushQuizId: quiz.id, attemptId: row.attempt_id },
              {
                onError: (err) =>
                  Alert.alert(
                    hi ? "रीसेट नहीं हुआ" : "Couldn't reset the attempt",
                    apiErrorMessage(err, hi),
                  ),
              },
            ),
        },
      ],
    );
  }

  return (
    <>
      <Button
        label={hi ? "वापस" : "Back"}
        icon="arrow-back"
        variant="ghost"
        onPress={onBack}
      />
      <Card>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Title style={{ fontSize: 16 }}>{hi ? "कक्षा प्रश्नोत्तरी" : "Class quiz"}</Title>
            <Body muted style={{ fontSize: 12, marginTop: 3 }}>
              {quiz.question_count} {hi ? "प्रश्न" : "questions"}
            </Body>
          </View>
          <Pill
            label={
              quiz.is_live
                ? `${hi ? "लाइव" : "Live"} · ${minutesLeft(quiz.expires_at)}${hi ? " मि" : "m"}`
                : hi
                  ? "समाप्त"
                  : "Ended"
            }
            tone={quiz.is_live ? "success" : "neutral"}
          />
        </Row>
        {data ? (
          <Row style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
            <Pill
              label={`${data.submitted_count} / ${data.eligible_count} ${hi ? "जमा" : "submitted"}`}
              tone="info"
            />
            <Pill
              label={`${hi ? "औसत" : "Avg"} ${Number(data.average_score ?? 0).toFixed(1)}`}
              tone="neutral"
            />
          </Row>
        ) : null}
        {quiz.is_live ? (
          <View style={{ marginTop: 14 }}>
            <Button
              label={hi ? "अभी समाप्त करें" : "End quiz now"}
              icon="stop-circle"
              variant="outline"
              loading={endQuiz.isPending}
              onPress={confirmEnd}
            />
          </View>
        ) : null}
      </Card>

      {roster.isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : roster.isError ? (
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "सूची लोड नहीं हुई।" : "Could not load the roster."}
          onRetry={roster.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      ) : (data?.items.length ?? 0) === 0 ? (
        <StateView
          status="empty"
          emptyText={
            hi ? "अभी किसी ने उत्तर नहीं दिया।" : "Nobody has answered yet."
          }
        />
      ) : (
        data!.items.map((row) => (
          <Card key={row.attempt_id}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Title style={{ fontSize: 15 }}>{row.full_name}</Title>
                <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                  {row.submitted_at
                    ? `${row.correct_count} / ${row.total_count} ${hi ? "सही" : "correct"}`
                    : hi
                      ? "जारी"
                      : "In progress"}
                </Body>
              </View>
              {row.points_awarded > 0 ? (
                <Pill label={`+${row.points_awarded}`} tone="success" />
              ) : null}
            </Row>
            {row.submitted_at ? (
              <View style={{ marginTop: 10 }}>
                <Button
                  label={hi ? "रीसेट करें" : "Reset"}
                  icon="refresh"
                  variant="ghost"
                  loading={
                    resetAttempt.isPending &&
                    resetAttempt.variables?.attemptId === row.attempt_id
                  }
                  onPress={() => confirmReset(row)}
                />
              </View>
            ) : null}
            <View style={{ height: 1, backgroundColor: c.border, marginTop: 4 }} />
          </Card>
        ))
      )}
    </>
  );
}

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function ShikshakQuizzesScreen() {
  const { hi } = useLocale();
  const batchesQ = useAdminBatches();
  const batches = useMemo(() => batchesQ.data?.items ?? [], [batchesQ.data]);

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [minutes, setMinutes] = useState<number>(15);
  const [drafts, setDrafts] = useState<DraftQuestion[]>([emptyQuestion()]);
  const [openQuizId, setOpenQuizId] = useState<string | null>(null);

  const quizzes = useMyPushQuizzes();
  const startQuiz = useStartPushQuiz();
  const items = quizzes.data?.items ?? [];
  const openQuiz = items.find((q) => q.id === openQuizId) ?? null;

  useEffect(() => {
    void AsyncStorage.getItem(BATCH_KEY).then((stored) => {
      if (stored) setSelectedBatchId(stored);
    });
  }, []);

  useEffect(() => {
    if (batches.length === 0) return;
    const stillValid = selectedBatchId && batches.some((b) => b.id === selectedBatchId);
    if (!stillValid) {
      const next = batches[0]!.id;
      setSelectedBatchId(next);
      void AsyncStorage.setItem(BATCH_KEY, next);
    }
  }, [batches, selectedBatchId]);

  function pickBatch(id: string) {
    setSelectedBatchId(id);
    void AsyncStorage.setItem(BATCH_KEY, id);
  }

  function resetComposer() {
    setComposing(false);
    setMinutes(15);
    setDrafts([emptyQuestion()]);
  }

  function start() {
    if (!selectedBatchId) return;
    for (const d of drafts) {
      const err = draftError(d, hi);
      if (err) {
        Alert.alert(hi ? "प्रश्न पूरा करें" : "Finish the question", err);
        return;
      }
    }
    startQuiz.mutate(
      {
        batch_id: selectedBatchId,
        minutes,
        questions: drafts.map(draftToPayload),
      },
      {
        onSuccess: (data) => {
          resetComposer();
          setOpenQuizId(data.id);
          void quizzes.refetch();
        },
        onError: (err) =>
          Alert.alert(
            hi ? "प्रश्नोत्तरी शुरू नहीं हुई" : "Couldn't start the quiz",
            apiErrorMessage(err, hi),
          ),
      },
    );
  }

  return (
    <ActivityThemed accent="quizzes">
      <AppHeader
        title={hi ? "कक्षा प्रश्नोत्तरी" : "Class quiz"}
        subtitle={
          hi
            ? "कक्षा के दौरान तुरंत प्रश्नोत्तरी चलाएँ"
            : "Run a quick quiz during your session"
        }
      />
      <Screen refreshing={quizzes.isRefetching} onRefresh={quizzes.refetch}>
        {openQuiz ? (
          <LiveRoster quiz={openQuiz} hi={hi} onBack={() => setOpenQuizId(null)} />
        ) : composing ? (
          <>
            <Card>
              <Title style={{ fontSize: 16 }}>
                {hi ? "कितनी देर चले?" : "How long should it run?"}
              </Title>
              <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                {DURATION_CHOICES.map((m) => (
                  <Button
                    key={m}
                    label={`${m} ${hi ? "मिनट" : "min"}`}
                    variant={minutes === m ? "primary" : "outline"}
                    onPress={() => setMinutes(m)}
                  />
                ))}
              </Row>
              <Body muted style={{ fontSize: 12, marginTop: 10 }}>
                {hi
                  ? "पुण्य मानक दर से मिलेगा।"
                  : "Punya is awarded at the standard rate."}
              </Body>
            </Card>

            {drafts.map((d, i) => (
              <Card key={i}>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Title style={{ fontSize: 15 }}>
                    {hi ? `प्रश्न ${i + 1}` : `Question ${i + 1}`}
                  </Title>
                  {drafts.length > 1 ? (
                    <Button
                      label={hi ? "हटाएँ" : "Remove"}
                      icon="trash"
                      variant="ghost"
                      compact
                      onPress={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                    />
                  ) : null}
                </Row>
                <View style={{ marginTop: 12 }}>
                  <QuestionComposer
                    draft={d}
                    hi={hi}
                    onChange={(next) =>
                      setDrafts((prev) => prev.map((x, idx) => (idx === i ? next : x)))
                    }
                  />
                </View>
              </Card>
            ))}

            <Button
              label={hi ? "और प्रश्न जोड़ें" : "Add another question"}
              icon="add"
              variant="outline"
              disabled={drafts.length >= 50}
              onPress={() => setDrafts((prev) => [...prev, emptyQuestion()])}
            />
            <Button
              label={hi ? "प्रश्नोत्तरी शुरू करें" : "Start the quiz"}
              icon="flash"
              loading={startQuiz.isPending}
              onPress={start}
            />
            <Button
              label={hi ? "रद्द करें" : "Cancel"}
              variant="ghost"
              onPress={resetComposer}
            />
          </>
        ) : (
          <>
            {batches.length > 1 ? (
              <Card>
                <Body muted style={{ fontSize: 12 }}>
                  {hi ? "बैच चुनें" : "Batch"}
                </Body>
                <Row style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                  {batches.map((b) => (
                    <Button
                      key={b.id}
                      label={b.name ?? (hi ? "बैच" : "Batch")}
                      variant={selectedBatchId === b.id ? "primary" : "outline"}
                      onPress={() => pickBatch(b.id)}
                    />
                  ))}
                </Row>
              </Card>
            ) : null}

            <Button
              label={hi ? "नई प्रश्नोत्तरी शुरू करें" : "Start a class quiz"}
              icon="flash"
              disabled={!selectedBatchId}
              onPress={() => setComposing(true)}
            />

            {quizzes.isLoading ? (
              <StateView status="loading" emptyText="" />
            ) : quizzes.isError ? (
              <StateView
                status="error"
                emptyText=""
                errorText={hi ? "सूची लोड नहीं हुई।" : "Could not load your quizzes."}
                onRetry={quizzes.refetch}
                retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
              />
            ) : items.length === 0 ? (
              <StateView
                status="empty"
                emptyText={
                  hi
                    ? "अभी तक कोई कक्षा प्रश्नोत्तरी नहीं। ऊपर से पहली शुरू करें।"
                    : "No class quizzes yet. Start your first one above."
                }
              />
            ) : (
              items.map((q) => (
                <Card key={q.id}>
                  <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Title style={{ fontSize: 15 }}>
                        {q.question_count} {hi ? "प्रश्न" : "questions"}
                      </Title>
                      <Body muted style={{ fontSize: 12, marginTop: 3 }}>
                        {q.submitted_count} {hi ? "ने जमा किया" : "submitted"}
                      </Body>
                    </View>
                    <Pill
                      label={
                        q.is_live
                          ? `${hi ? "लाइव" : "Live"} · ${minutesLeft(q.expires_at)}${hi ? " मि" : "m"}`
                          : hi
                            ? "समाप्त"
                            : "Ended"
                      }
                      tone={q.is_live ? "success" : "neutral"}
                    />
                  </Row>
                  <View style={{ marginTop: 12 }}>
                    <Button
                      label={hi ? "परिणाम देखें" : "View results"}
                      icon="podium"
                      variant="outline"
                      onPress={() => setOpenQuizId(q.id)}
                    />
                  </View>
                </Card>
              ))
            )}
          </>
        )}
      </Screen>
    </ActivityThemed>
  );
}
