import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import {
  useAttendance,
  useCentreHolidaysPublic,
  useCreateStudentAbsence,
  useStudentAbsences,
} from "@/lib/queries";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import {
  buildMonthDayCells,
  buildMonthListEntries,
  calendarEventTone,
  currentMonthIst,
  shiftMonth,
  type MonthListEntry,
} from "@/lib/attendance-calendar";
import { formatDate } from "@/lib/format";
import { bodyFamily } from "@/constants/typography";
import { AttendanceMonthCalendar } from "@/components/AttendanceMonthCalendar";
import {
  HolidayMonthCalendar,
  expandInclusiveDateRange,
} from "@/components/HolidayMonthCalendar";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { useCelebration } from "@/hooks/useCelebration";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { ApiError } from "@/lib/api";

/** Local calendar date as YYYY-MM-DD, offset by `days`. */
function isoDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function NotifyLeaveModal({
  open,
  onClose,
  studentId,
  holidays = [],
  onLeaveSent,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  /** Published centre holidays, so we don't ask for a notice nobody can use. */
  holidays?: Array<{ holiday_date: string; reason?: string | null }>;
  /** Fired after a successful leave notice (parent celebrates on the screen behind). */
  onLeaveSent?: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const create = useCreateStudentAbsence(studentId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const todayIso = isoDateOffset(0);
  /** Which end of the range the next tap sets (two-phase picker). */
  const [picking, setPicking] = useState<"start" | "end">("start");
  const [month, setMonth] = useState(() => todayIso.slice(0, 7));

  /** Quick picks still cover the common cases in one tap. */
  const quickPicks: { label: string; start: string; end: string }[] = [
    { label: hi ? "आज" : "Today", start: todayIso, end: todayIso },
    { label: hi ? "कल" : "Tomorrow", start: isoDateOffset(1), end: isoDateOffset(1) },
    {
      label: hi ? "अगले 3 दिन" : "Next 3 days",
      start: isoDateOffset(1),
      end: isoDateOffset(3),
    },
  ];

  const applyQuickPick = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    setMonth(start.slice(0, 7));
    setPicking("start");
  };

  /**
   * First tap sets the start and clears the end; the second closes the range.
   * A tap before the current start restarts the range there rather than
   * producing an inverted one, so end < start is unreachable.
   */
  const onDayPress = (date: string) => {
    if (picking === "start" || !startDate || date < startDate) {
      setStartDate(date);
      setEndDate("");
      setPicking("end");
      return;
    }
    setEndDate(date);
    setPicking("start");
  };

  const resetForm = () => {
    setStartDate("");
    setEndDate("");
    setReason("");
    setPicking("start");
    setMonth(todayIso.slice(0, 7));
  };

  /** Dismissing without sending must not leave a half-picked range waiting. */
  const closeAndReset = () => {
    resetForm();
    onClose();
  };

  /** End defaults to start — a one-day notice needs only one tap. */
  const effectiveEnd = endDate || startDate;

  const inputStyle = {
    fontFamily: bodyFamily(hi),
    fontSize: 16,
    lineHeight: 22,
    color: c.foreground,
    backgroundColor: c.muted,
    borderRadius: c.radius ?? 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  } as const;

  const submit = () => {
    // The calendar only yields well-formed, non-past, non-inverted dates, so the
    // shape / past-date / end-before-start checks that used to live here are now
    // prevented at the point of entry instead of scolding after the fact. Only
    // the guard the picker cannot express survives.
    if (!startDate) {
      Alert.alert(
        hi ? "तिथि चुनें" : "Pick the dates",
        hi
          ? "कैलेंडर में अवकाश का दिन चुनें — एक दिन के लिए एक ही तिथि पर टैप करें।"
          : "Tap the day of leave on the calendar — for a single day, tap just that one date.",
      );
      return;
    }
    // If every day in the range is already a published holiday, the notice can
    // never be consumed — say so instead of accepting a silent no-op that the
    // parent later raises a service request about.
    const holidaySet = new Set(holidays.map((h) => h.holiday_date));
    const days = expandInclusiveDateRange(startDate, effectiveEnd);
    if (days.length > 0 && days.every((d) => holidaySet.has(d))) {
      Alert.alert(
        hi ? "उन दिनों अवकाश है" : "Those days are already a holiday",
        hi
          ? "चुने गए सभी दिन केंद्र के घोषित अवकाश हैं — उस दिन कक्षा नहीं है, इसलिए सूचना की आवश्यकता नहीं।"
          : "Every day you picked is already a centre holiday, so there is no class to miss — no notice needed.",
      );
      return;
    }
    create.mutate(
      {
        start_date: startDate,
        end_date: effectiveEnd,
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => {
          resetForm();
          onClose();
          onLeaveSent?.();
        },
        onError: (err) => {
          const msg =
            err instanceof ApiError
              ? err.message
              : hi
                ? "अवकाश सूचना नहीं भेजी जा सकी।"
                : "Could not send leave notice.";
          Alert.alert(hi ? "त्रुटि" : "Error", msg);
        },
      },
    );
  };

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeAndReset}
    >
      <View style={{ flex: 1, backgroundColor: c.background }}>
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
            {hi ? "अवकाश सूचित करें" : "Notify leave"}
          </Title>
          <Pressable onPress={closeAndReset} hitSlop={12}>
            <Text style={{ fontSize: 16, color: c.primary, fontFamily: bodyFamily(hi, "semibold") }}>
              {hi ? "बंद करें" : "Close"}
            </Text>
          </Pressable>
        </View>

        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
          bottomOffset={20}
          keyboardShouldPersistTaps="handled"
        >
          <Body muted style={{ marginBottom: 14, lineHeight: 22 }}>
            {hi
              ? "गुरुजी को पहले से बता दें — उस दिन उपस्थिति में क्षमा के रूप में दिख सकता है।"
              : "Tell Guruji in advance — covered days may show as excused when attendance is marked."}
          </Body>
          {/* Most leave notices are today / tomorrow / a short block. */}
          <Row style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {quickPicks.map((q) => (
              <Pressable
                key={q.label}
                onPress={() => applyQuickPick(q.start, q.end)}
                style={{
                  borderWidth: 1,
                  borderColor:
                    startDate === q.start && effectiveEnd === q.end ? c.primary : c.border,
                  backgroundColor:
                    startDate === q.start && effectiveEnd === q.end ? c.accent : c.card,
                  borderRadius: 999,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                }}
              >
                <Body style={{ fontSize: 13 }}>{q.label}</Body>
              </Pressable>
            ))}
          </Row>

          {/* Tap-to-pick range. Past days are inert (minDate), so a notice for a
              day already gone — which the marking UI could never consume — is
              simply not expressible. */}
          <Body muted style={{ fontSize: 12, marginBottom: 6, lineHeight: 22 }}>
            {!startDate
              ? hi
                ? "कैलेंडर में अवकाश का दिन चुनें"
                : "Tap the day of leave on the calendar"
              : picking === "end"
                ? hi
                  ? "आखिरी दिन चुनें, या भेजें दबाएँ — एक दिन के अवकाश के लिए"
                  : "Tap the last day, or just send — for a single day of leave"
                : hi
                  ? "चयनित अवकाश"
                  : "Leave selected"}
          </Body>
          {startDate ? (
            <Body style={{ fontSize: 14, marginBottom: 8, lineHeight: 22 }}>
              {startDate === effectiveEnd
                ? formatDate(startDate)
                : `${formatDate(startDate)} → ${formatDate(effectiveEnd)}`}
            </Body>
          ) : null}
          <View style={{ marginBottom: 12 }}>
            <HolidayMonthCalendar
              month={month}
              onMonthChange={setMonth}
              holidayDates={holidays.map((h) => h.holiday_date)}
              rangeStart={startDate || null}
              rangeEnd={endDate || null}
              onDayPress={onDayPress}
              minDate={todayIso}
              rangeLegendLabel={hi ? "चयनित अवकाश" : "Selected leave"}
            />
          </View>
          <Body muted style={{ fontSize: 12, marginBottom: 4, lineHeight: 22 }}>
            {hi ? "कारण (वैकल्पिक)" : "Reason (optional)"}
          </Body>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={hi ? "उदा. पारिवारिक यात्रा" : "e.g. Family travel"}
            placeholderTextColor={c.mutedForeground}
            style={inputStyle}
          />
          <Button
            label={hi ? "भेजें" : "Send notice"}
            onPress={submit}
            loading={create.isPending}
            disabled={!startDate || create.isPending}
          />
        </KeyboardAwareScrollViewCompat>
      </View>
    </Modal>
  );
}

/** Month calendar + concise list for the active student (parent / student-view). */
export default function MyAttendanceScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();
  const maxMonth = shiftMonth(currentMonthIst(), 12);
  const [month, setMonth] = useState(currentMonthIst());
  const [leaveOpen, setLeaveOpen] = useState(false);
  const { fire: celebrate, Celebration } = useCelebration();

  const attendance = useAttendance(activeStudentId ?? undefined, true, {
    month,
    limit: 120,
  });
  const absences = useStudentAbsences(activeStudentId ?? undefined, month);
  const holidays = useCentreHolidaysPublic(activeChild?.centre_id ?? null);

  const markRows = attendance.data?.items ?? [];
  const leaveRows = absences.data?.items ?? [];
  const holidayRows = holidays.data?.items ?? [];

  // AT5 — server SQL only; never derive % from items.
  const presentRate =
    attendance.data?.attendance_percent ??
    (attendance.data?.attendance_rate != null
      ? Math.round(attendance.data.attendance_rate * 100)
      : null);

  const cells = useMemo(
    () =>
      buildMonthDayCells({
        month,
        marks: markRows,
        leaveRanges: leaveRows,
        holidays: holidayRows,
      }),
    [month, markRows, leaveRows, holidayRows],
  );

  const listEntries = useMemo(
    () =>
      buildMonthListEntries({
        month,
        marks: markRows,
        leaveRanges: leaveRows,
        holidays: holidayRows,
        hi,
      }),
    [month, markRows, leaveRows, holidayRows, hi],
  );

  const onRefresh = useCallback(() => {
    refetch();
    void attendance.refetch();
    void absences.refetch();
    void holidays.refetch();
  }, [refetch, attendance, absences, holidays]);

  const renderEntry: ListRenderItem<MonthListEntry> = useCallback(
    ({ item, index }) => {
      const tone = calendarEventTone(item.kind);
      return (
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderBottomWidth: index < listEntries.length - 1 ? 1 : 0,
            borderBottomColor: c.border,
          }}
        >
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "600" }}>{formatDate(item.date)}</Body>
            <Pill label={item.label} tone={tone} />
          </Row>
          {item.note ? (
            <Body muted style={{ marginTop: 2, fontSize: 13 }}>
              {item.note}
            </Body>
          ) : null}
        </View>
      );
    },
    [c.border, listEntries.length],
  );

  const keyExtractor = useCallback((item: MonthListEntry) => item.id, []);

  const queriesLoading =
    attendance.isLoading || absences.isLoading || (holidays.isLoading && !!activeChild?.centre_id);
  const queriesError = attendance.isError || absences.isError;

  const listHeader = (
    <>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Title style={{ fontSize: 22 }}>{hi ? "उपस्थिति" : "Attendance"}</Title>
          <Body muted style={{ marginTop: 2 }}>
            {hi ? "मासिक कैलेंडर और रिकॉर्ड" : "Month calendar and records"}
          </Body>
        </View>
        {presentRate !== null ? (
          <Pill
            label={hi ? `${presentRate}% उपस्थित` : `${presentRate}% present`}
            tone={presentRate >= 75 ? "success" : presentRate >= 50 ? "warning" : "error"}
          />
        ) : null}
      </Row>

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

          <Button
            label={hi ? "अवकाश सूचित करें" : "Notify leave"}
            variant="outline"
            onPress={() => setLeaveOpen(true)}
            style={{ marginTop: 8 }}
          />

          {queriesLoading ? (
            <StateView status="loading" emptyText="" />
          ) : queriesError ? (
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "उपस्थिति लोड नहीं हुई।" : "Could not load attendance."}
              onRetry={onRefresh}
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          ) : (
            <>
              <View style={{ marginTop: 4 }}>
                <AttendanceMonthCalendar
                  month={month}
                  onMonthChange={setMonth}
                  maxMonth={maxMonth}
                  cells={cells}
                />
              </View>

              {listEntries.length === 0 ? (
                <StateView
                  status="empty"
                  emptyText={
                    hi
                      ? "इस माह कोई दर्ज उपस्थिति, अवकाश या छुट्टी नहीं है।"
                      : "No recorded attendance, leave, or holidays this month."
                  }
                />
              ) : (
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  <FlatList
                    data={listEntries}
                    keyExtractor={keyExtractor}
                    renderItem={renderEntry}
                    scrollEnabled={false}
                  />
                </Card>
              )}
            </>
          )}

          <NotifyLeaveModal
            open={leaveOpen}
            onClose={() => setLeaveOpen(false)}
            studentId={activeStudentId}
            // The screen behind already knows the centre's published holidays;
            // the modal used to ignore them, so a parent could file a notice for
            // days that have no session — which AT4 can never consume.
            holidays={holidayRows}
            onLeaveSent={() => {
              celebrate({
                message: hi ? "अवकाश सूचित" : "Leave noted",
              });
            }}
          />
        </>
      )}
    </>
  );

  return (
    <ActivityThemed accent="attendance">
    <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0 }}>
      {Celebration}
      <FlatList
        data={[]}
        renderItem={() => null}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 22 }}
        refreshControl={
          <RefreshControl
            refreshing={
              !!attendance.isRefetching || !!absences.isRefetching || !!holidays.isRefetching
            }
            onRefresh={onRefresh}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS !== "web"}
      />
    </Screen>
    </ActivityThemed>
  );
}
