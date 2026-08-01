import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAttendance } from "@/lib/queries";
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

  const presentCount = rows.filter((r) => r.status.toLowerCase() === "present").length;
  const presentRate =
    rows.length > 0 ? Math.round((presentCount / rows.length) * 100) : null;

  return (
    <Screen
      refreshing={attendance.isRefetching}
      onRefresh={() => {
        refetch();
        attendance.refetch();
      }}
    >
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
                    <Body style={{ fontWeight: "600" }}>{formatDate(row.session_date)}</Body>
                    <Pill label={row.status} tone={attendanceTone(row.status)} />
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
        </>
      )}
    </Screen>
  );
}
