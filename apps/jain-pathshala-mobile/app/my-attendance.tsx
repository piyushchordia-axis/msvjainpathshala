import { useCallback } from "react";
import { FlatList, Platform, RefreshControl, View, type ListRenderItem } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAttendance } from "@/lib/queries";
import type { AttendanceRow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

function attendanceTone(status: string): "success" | "warning" | "error" | "neutral" {
  const s = status.toLowerCase();
  if (s === "present") return "success";
  if (s === "late") return "warning";
  if (s === "absent") return "error";
  return "neutral";
}

/** Full attendance history for the active student (parent / student). */
export default function MyAttendanceScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();
  const attendance = useAttendance(activeStudentId ?? undefined);
  const rows = attendance.data?.items ?? [];
  // AT5 — server SQL only; never derive % from items (excused/late/holiday drift).
  const presentRate =
    attendance.data?.attendance_percent ??
    (attendance.data?.attendance_rate != null
      ? Math.round(attendance.data.attendance_rate * 100)
      : null);

  const onRefresh = useCallback(() => {
    refetch();
    attendance.refetch();
  }, [refetch, attendance]);

  const renderRow: ListRenderItem<AttendanceRow> = useCallback(
    ({ item, index }) => (
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderBottomWidth: index < rows.length - 1 ? 1 : 0,
          borderBottomColor: c.border,
        }}
      >
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Body style={{ fontWeight: "600" }}>{formatDate(item.session_date)}</Body>
          <Pill label={item.status} tone={attendanceTone(item.status)} />
        </Row>
        {item.topic ? (
          <Body muted style={{ marginTop: 2, fontSize: 13 }}>
            {item.topic}
          </Body>
        ) : null}
        {item.batch_name ? (
          <Body muted style={{ marginTop: 2, fontSize: 12 }}>
            {item.batch_name}
          </Body>
        ) : null}
      </View>
    ),
    [c.border, rows.length],
  );

  const keyExtractor = useCallback((item: AttendanceRow) => item.id, []);

  const listHeader = (
    <>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Title style={{ fontSize: 22 }}>{hi ? "उपस्थिति" : "Attendance"}</Title>
          <Body muted style={{ marginTop: 2 }}>
            {hi ? "सभी दर्ज उपस्थिति रिकॉर्ड" : "All recorded attendance"}
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
          {attendance.isLoading ? (
            <StateView status="loading" emptyText="" />
          ) : attendance.isError ? (
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "उपस्थिति लोड नहीं हुई।" : "Could not load attendance."}
              onRetry={attendance.refetch}
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          ) : rows.length === 0 ? (
            <StateView
              status="empty"
              emptyText={hi ? "अभी कोई उपस्थिति दर्ज नहीं है।" : "No attendance recorded yet."}
            />
          ) : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <FlatList
                data={rows}
                keyExtractor={keyExtractor}
                renderItem={renderRow}
                scrollEnabled={false}
              />
            </Card>
          )}
        </>
      )}
    </>
  );

  return (
    <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0 }}>
      <FlatList
        data={[]}
        renderItem={() => null}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={!!attendance.isRefetching}
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
  );
}
