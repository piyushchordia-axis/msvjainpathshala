/**
 * Shikshak attendance-marking screen.
 *
 * Flow: load today's session roster (GET /v1/sessions/today?session_id=),
 * toggle each student present / absent (UI), then enqueue via POST /v1/sync/batch.
 * Excused is seeded from advance absence notices (AT4) and kept until overwritten.
 * Geofencing belongs on check-in / check-out only (AT32) — this screen never captures GPS.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { Body, Button, Pill, Row, Screen, StateView, Title } from "@/components/ui";

type Feedback =
  | { tone: "success"; title: string; detail: string }
  | { tone: "error"; title: string; detail: string }
  | null;

export default function AttendanceMarkScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const insets = useSafeAreaInsets();
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
  const showFooter = !cancelled && roster.length > 0;

  const listHeader = (
    <View style={{ gap: 10, marginBottom: 4 }}>
      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Title style={{ fontSize: 17 }}>{session.batch_name ?? (hi ? "बैच" : "Batch")}</Title>
            <Body muted style={{ fontSize: 12, marginTop: 2 }}>
              {[session.centre_name, formatDate(session.session_date)].filter(Boolean).join(" · ")}
            </Body>
          </View>
          <Pill label={session.status} tone={cancelled ? "error" : "neutral"} />
        </Row>
        {session.topic ? (
          <Body muted numberOfLines={1} style={{ fontSize: 13 }}>
            {session.topic}
          </Body>
        ) : null}
        <Row style={{ marginTop: 4, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Body muted style={{ fontSize: 12 }}>
            {`${markedCount} / ${roster.length} ${hi ? "चिह्नित" : "marked"}`}
            {allMarked ? (hi ? " ✓" : " ✓") : ""}
          </Body>
          {session.gps_required ? (
            <Pressable onPress={() => setCheckInOpen(true)} disabled={cancelled}>
              <Pill
                label={hi ? "चेक-इन" : "Check-in"}
                tone="info"
              />
            </Pressable>
          ) : null}
        </Row>
      </View>

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
        <Row style={{ gap: 8 }}>
          <Button
            label={hi ? "सभी उपस्थित" : "All present"}
            icon="checkmark-done"
            variant="outline"
            onPress={() => setAll("present")}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button
            label={hi ? "सभी अनुपस्थित" : "All absent"}
            icon="close"
            variant="ghost"
            onPress={() => setAll("absent")}
            style={{ flex: 1, minWidth: 0 }}
          />
        </Row>
      )}

      {needsCheckIn && !cancelled ? (
        <Body muted style={{ fontSize: 12 }}>
          {hi
            ? "केंद्र पर चेक-इन अनुशंसित है — उपस्थिति बिना चेक-इन के भी दर्ज हो सकती है।"
            : "Centre check-in is recommended — you can still mark without it."}
        </Body>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0, paddingBottom: 0 }}>
      <View style={{ flex: 1 }}>
        <FlatList
          data={cancelled || roster.length === 0 ? [] : roster}
          keyExtractor={rosterKeyExtractor}
          renderItem={renderRosterItem}
          getItemLayout={rosterGetItemLayout}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 16 }}
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
          initialNumToRender={16}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews={Platform.OS !== "web"}
        />

        {showFooter ? (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: c.border,
              backgroundColor: c.background,
              paddingHorizontal: 18,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom, 12),
              gap: 8,
            }}
          >
            {feedback ? (
              <Row style={{ gap: 8, alignItems: "flex-start" }}>
                <Ionicons
                  name={feedback.tone === "success" ? "checkmark-circle" : "close-circle"}
                  size={20}
                  color={fbColor}
                />
                <View style={{ flex: 1 }}>
                  <Body style={{ color: fbColor, fontFamily: bodyFamily(hi, "semibold"), fontSize: 13 }}>
                    {feedback.title}
                  </Body>
                  <Body muted style={{ marginTop: 2, fontSize: 12, lineHeight: 18 }}>
                    {feedback.detail}
                  </Body>
                </View>
              </Row>
            ) : null}

            <Button
              label={
                feedback?.tone === "success"
                  ? hi
                    ? "पुनः जमा करें"
                    : "Save again"
                  : hi
                    ? "उपस्थिति जमा करें"
                    : "Save attendance"
              }
              icon="save"
              loading={mark.isPending}
              disabled={markedCount === 0}
              onPress={() => void submit()}
            />
            {feedback?.tone === "success" ? (
              <Button
                label={hi ? "डैशबोर्ड पर वापस जाएँ" : "Back to dashboard"}
                icon="arrow-back"
                variant="ghost"
                onPress={() => router.back()}
              />
            ) : null}
          </View>
        ) : null}
      </View>

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
