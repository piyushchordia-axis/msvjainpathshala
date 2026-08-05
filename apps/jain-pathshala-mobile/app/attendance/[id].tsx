/**
 * Shikshak attendance-marking screen.
 *
 * Flow: load today's session roster (GET /v1/sessions/today?session_id=),
 * toggle each student present / absent / late / excused, then enqueue via
 * POST /v1/sync/batch. Geofencing belongs on check-in / check-out only (AT32) —
 * this screen never captures GPS.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  useAttendanceSession,
  useMarkAttendance,
  type AttendanceMark,
  type AttendanceRosterRow as RosterEntry,
} from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { bodyFamily } from "@/constants/typography";
import {
  RosterRow,
  ROSTER_ROW_HEIGHT,
} from "@/components/AttendanceRosterRow";
import { SessionCheckIn } from "@/components/SessionCheckIn";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

type Feedback =
  | { tone: "success"; title: string; detail: string }
  | { tone: "error"; title: string; detail: string }
  | null;

export default function AttendanceMarkScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();

  const detail = useAttendanceSession(id);
  const mark = useMarkAttendance();

  const [marks, setMarks] = useState<Record<string, AttendanceMark>>({});
  const [seeded, setSeeded] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);

  const session = detail.data?.session ?? null;
  const roster = useMemo(() => detail.data?.roster ?? [], [detail.data]);

  useEffect(() => {
    if (seeded || !detail.data) return;
    const initial: Record<string, AttendanceMark> = {};
    for (const r of roster) {
      if (r.status) initial[r.student_id] = r.status;
      else if (r.suggested_status === "excused") initial[r.student_id] = "excused";
    }
    setMarks(initial);
    setSeeded(true);
  }, [seeded, detail.data, roster]);

  const markedCount = Object.keys(marks).length;
  const allMarked = roster.length > 0 && markedCount === roster.length;
  const needsCheckIn = !!session?.gps_required && !session?.check_in_at;

  const onMark = useCallback((studentId: string, value: AttendanceMark) => {
    setFeedback(null);
    setMarks((prev) => ({ ...prev, [studentId]: value }));
  }, []);

  const setAll = useCallback(
    (value: AttendanceMark) => {
      setFeedback(null);
      const next: Record<string, AttendanceMark> = {};
      for (const r of roster) next[r.student_id] = value;
      setMarks(next);
    },
    [roster],
  );

  async function submit() {
    if (!session || roster.length === 0 || markedCount === 0) return;
    setFeedback(null);

    const records = Object.entries(marks).map(([student_id, status]) => ({
      student_id,
      status,
    }));

    mark.mutate(
      {
        sessionId: session.id,
        batchId: session.batch_id,
        sessionDate: session.session_date,
        records,
      },
      {
        onSuccess: (res) => {
          if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setFeedback({
            tone: "success",
            title: hi ? "ऑफ़लाइन कतार में" : "Saved — will sync",
            detail: hi
              ? `${res.marked} विद्यार्थी सहेजे गए। नेटवर्क पर सिंक होगा।`
              : `${res.marked} student(s) queued. Syncs when online.`,
          });
        },
        onError: (err) => {
          if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setFeedback({
            tone: "error",
            title: hi ? "दर्ज नहीं हो सका" : "Couldn't save",
            detail: err instanceof ApiError ? err.message : hi ? "पुनः प्रयास करें।" : "Please try again.",
          });
        },
      },
    );
  }

  const renderRosterItem = useCallback(
    ({ item }: { item: RosterEntry }) => (
      <RosterRow
        studentId={item.student_id}
        name={item.full_name ?? item.student_code}
        code={item.student_code}
        status={marks[item.student_id]}
        hi={hi}
        onMark={onMark}
      />
    ),
    [marks, hi, onMark],
  );

  const rosterKeyExtractor = useCallback((item: RosterEntry) => item.student_id, []);

  const rosterGetItemLayout = useCallback(
    (_data: ArrayLike<RosterEntry> | null | undefined, index: number) => ({
      length: ROSTER_ROW_HEIGHT,
      offset: ROSTER_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  if (detail.isLoading) {
    return (
      <Screen scroll={false}>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }
  if (detail.isError || !session) {
    const notAllowed = detail.error instanceof ApiError && detail.error.statusCode === 404;
    return (
      <Screen scroll={false}>
        <StateView
          status={notAllowed ? "empty" : "error"}
          emptyText={
            hi
              ? "यह सत्र आपके लिए उपलब्ध नहीं है।"
              : "This session isn't available to you."
          }
          errorText={hi ? "सत्र लोड नहीं हो सका।" : "Could not load the session."}
          onRetry={notAllowed ? undefined : detail.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      </Screen>
    );
  }

  const cancelled = session.status === "cancelled";
  const fbColor =
    feedback?.tone === "success" ? c.successText : feedback?.tone === "error" ? c.errorText : c.mutedForeground;

  const listHeader = (
    <>
      <Card>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Title style={{ fontSize: 18 }}>{session.batch_name ?? (hi ? "बैच" : "Batch")}</Title>
            {session.centre_name ? (
              <Body muted style={{ fontSize: 12, marginTop: 2 }}>{session.centre_name}</Body>
            ) : null}
          </View>
          <Pill label={session.status} tone={cancelled ? "error" : "neutral"} />
        </Row>
        <Body muted style={{ fontSize: 13, marginTop: 8 }}>{formatDate(session.session_date)}</Body>
        {session.topic ? <Body style={{ marginTop: 6 }}>{session.topic}</Body> : null}
        <Row style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
          <Pill
            label={`${markedCount} / ${roster.length} ${hi ? "चिह्नित" : "marked"}`}
            tone={allMarked ? "success" : "neutral"}
          />
          {session.gps_required ? (
            <Pressable onPress={() => setCheckInOpen(true)} disabled={cancelled}>
              <Pill
                label={
                  hi
                    ? "केंद्र पर चेक-इन आवश्यक"
                    : "Check-in at the centre required"
                }
                tone="info"
              />
            </Pressable>
          ) : null}
        </Row>
      </Card>

      {cancelled ? (
        <StateView
          status="empty"
          emptyText={hi ? "यह सत्र रद्द कर दिया गया है — उपस्थिति दर्ज नहीं की जा सकती।" : "This session is cancelled — attendance can't be marked."}
        />
      ) : roster.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "इस बैच में कोई सक्रिय विद्यार्थी नहीं है।" : "This batch has no active students."}
        />
      ) : (
        <Row style={{ gap: 10, flexWrap: "wrap" }}>
          <Button
            label={hi ? "सभी उपस्थित" : "Mark all present"}
            icon="checkmark-done"
            variant="outline"
            onPress={() => setAll("present")}
            style={{ flex: 1, minWidth: 150 }}
          />
          <Button
            label={hi ? "सभी अनुपस्थित" : "Mark all absent"}
            icon="close"
            variant="ghost"
            onPress={() => setAll("absent")}
            style={{ flex: 1, minWidth: 150 }}
          />
        </Row>
      )}
    </>
  );

  const listFooter =
    cancelled || roster.length === 0 ? null : (
      <>
        {feedback ? (
          <Card style={{ borderColor: fbColor }}>
            <Row style={{ gap: 10, alignItems: "flex-start" }}>
              <Ionicons
                name={feedback.tone === "success" ? "checkmark-circle" : "close-circle"}
                size={22}
                color={fbColor}
              />
              <View style={{ flex: 1 }}>
                <Body style={{ color: fbColor, fontFamily: bodyFamily(hi, "semibold") }}>{feedback.title}</Body>
                <Body muted style={{ marginTop: 2 }}>{feedback.detail}</Body>
              </View>
            </Row>
          </Card>
        ) : null}

        {needsCheckIn ? (
          <Body muted style={{ fontSize: 12, textAlign: "center" }}>
            {hi
              ? "इस सत्र के लिए केंद्र पर चेक-इन अनुशंसित है — उपस्थिति बिना चेक-इन के भी दर्ज हो सकती है।"
              : "This session asks for centre check-in — you can still mark attendance without it."}
          </Body>
        ) : null}

        <Button
          label={
            feedback?.tone === "success"
              ? hi ? "पुनः जमा करें" : "Save again"
              : hi ? "उपस्थिति जमा करें" : "Save attendance"
          }
          icon="save"
          loading={mark.isPending}
          disabled={markedCount === 0}
          onPress={() => void submit()}
        />
        {feedback?.tone === "success" ? (
          <Button
            label={hi ? "आज के सत्र पर वापस जाएँ" : "Back to today's sessions"}
            icon="arrow-back"
            variant="ghost"
            onPress={() => router.back()}
          />
        ) : null}
      </>
    );

  return (
    <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0 }}>
      <FlatList
        data={cancelled || roster.length === 0 ? [] : roster}
        keyExtractor={rosterKeyExtractor}
        renderItem={renderRosterItem}
        getItemLayout={rosterGetItemLayout}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={!!detail.isRefetching}
            onRefresh={detail.refetch}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== "web"}
      />
      <SessionCheckIn
        visible={checkInOpen}
        mode="checkin"
        batchId={session.batch_id}
        sessionDate={session.session_date}
        batchName={session.batch_name}
        onClose={() => setCheckInOpen(false)}
        onSettled={() => void detail.refetch()}
      />
    </Screen>
  );
}
