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
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { useCelebration } from "@/hooks/useCelebration";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { ApiError } from "@/lib/api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function NotifyLeaveModal({
  open,
  onClose,
  studentId,
  onLeaveSent,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  /** Fired after a successful leave notice (parent celebrates on the screen behind). */
  onLeaveSent?: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const create = useCreateStudentAbsence(studentId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

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
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      Alert.alert(
        hi ? "तिथि जाँचें" : "Check the dates",
        hi
          ? "शुरू और समाप्ति तिथि YYYY-MM-DD में लिखें।"
          : "Enter start and end dates as YYYY-MM-DD.",
      );
      return;
    }
    if (endDate < startDate) {
      Alert.alert(
        hi ? "तिथि जाँचें" : "Check the dates",
        hi
          ? "समाप्ति तिथि शुरू तिथि के बाद या उसी दिन होनी चाहिए।"
          : "End date must be on or after the start date.",
      );
      return;
    }
    create.mutate(
      {
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => {
          setStartDate("");
          setEndDate("");
          setReason("");
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
      onRequestClose={onClose}
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
          <Pressable onPress={onClose} hitSlop={12}>
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
          <Body muted style={{ fontSize: 12, marginBottom: 4, lineHeight: 22 }}>
            {hi ? "शुरू तिथि (YYYY-MM-DD)" : "Start date (YYYY-MM-DD)"}
          </Body>
          <TextInput
            value={startDate}
            onChangeText={setStartDate}
            placeholder="2026-08-10"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="none"
            style={inputStyle}
          />
          <Body muted style={{ fontSize: 12, marginBottom: 4, lineHeight: 22 }}>
            {hi ? "समाप्ति तिथि (YYYY-MM-DD)" : "End date (YYYY-MM-DD)"}
          </Body>
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="2026-08-12"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="none"
            style={inputStyle}
          />
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
