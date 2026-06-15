import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAttendance, usePunya } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { QuickActions } from "@/components/QuickActions";

export default function StudentHome() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const { activeChild, activeStudentId, loading, isError, refetch } = useSessionView();

  const attendance = useAttendance(activeStudentId ?? undefined);
  const punya = usePunya(activeStudentId ?? undefined);

  const firstName = user?.full_name?.split(" ")[0] ?? (hi ? "विद्यार्थी" : "Student");

  const attendanceRows = attendance.data?.items ?? [];
  const recentRows = attendanceRows.slice(0, 5);
  const presentCount = attendanceRows.filter(
    (r) => r.status.toLowerCase() === "present",
  ).length;
  const presentRate =
    attendanceRows.length > 0
      ? Math.round((presentCount / attendanceRows.length) * 100)
      : null;

  const statusTone = (status: string): "success" | "warning" | "error" | "neutral" => {
    const s = status.toLowerCase();
    if (s === "present") return "success";
    if (s === "late") return "warning";
    if (s === "absent") return "error";
    return "neutral";
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={`${hi ? "नमस्ते" : "Namaste"}, ${firstName}`}
        subtitle={hi ? "आपकी पाठशाला यात्रा" : "Your pathshala journey"}
      />
      <Screen refreshing={attendance.isRefetching} onRefresh={() => { refetch(); attendance.refetch(); punya.refetch(); }}>
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "आपकी जानकारी लोड नहीं हुई।" : "Could not load your details."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={hi ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।" : "Your student profile isn't ready yet."}
          />
        ) : (
          <>
            <QuickActions />
            <Card>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Title style={{ fontSize: 19 }}>{activeChild.full_name}</Title>
                  <Body muted style={{ marginTop: 2, fontSize: 13 }}>{activeChild.student_code}</Body>
                </View>
                <Pill label={activeChild.tier} tone="primary" />
              </Row>

              <Row style={{ marginTop: 14, alignItems: "baseline", gap: 8 }}>
                <Title style={{ fontSize: 30 }}>{activeChild.total_points}</Title>
                <Body muted>{hi ? "कुल पुण्य अंक" : "total punya points"}</Body>
              </Row>

              <View style={{ height: 1, backgroundColor: c.border, marginVertical: 14 }} />

              <View style={{ gap: 8 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Body muted style={{ fontSize: 13 }}>{hi ? "आयु वर्ग" : "Age group"}</Body>
                  <Body style={{ fontSize: 14 }}>{activeChild.age_group}</Body>
                </Row>
                <Row style={{ justifyContent: "space-between" }}>
                  <Body muted style={{ fontSize: 13 }}>{hi ? "केंद्र" : "Centre"}</Body>
                  <Body style={{ fontSize: 14 }}>{activeChild.centre_name ?? "—"}</Body>
                </Row>
                <Row style={{ justifyContent: "space-between" }}>
                  <Body muted style={{ fontSize: 13 }}>{hi ? "बैच" : "Batch"}</Body>
                  <Body style={{ fontSize: 14 }}>{activeChild.batch_name ?? "—"}</Body>
                </Row>
                <Row style={{ justifyContent: "space-between" }}>
                  <Body muted style={{ fontSize: 13 }}>{hi ? "एमएसवी स्थिति" : "MSV status"}</Body>
                  <Pill label={activeChild.msv_status} />
                </Row>
              </View>
            </Card>

            <Row style={{ justifyContent: "space-between", marginTop: 4, marginLeft: 2 }}>
              <Title style={{ fontSize: 17 }}>{hi ? "उपस्थिति" : "Attendance"}</Title>
              {presentRate !== null ? (
                <Pill
                  label={`${presentRate}% ${hi ? "उपस्थित" : "present"}`}
                  tone={presentRate >= 75 ? "success" : presentRate >= 50 ? "warning" : "error"}
                />
              ) : null}
            </Row>

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
            ) : recentRows.length === 0 ? (
              <StateView status="empty" emptyText={hi ? "अभी कोई उपस्थिति दर्ज नहीं है।" : "No attendance recorded yet."} />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {recentRows.map((row, i) => (
                  <Row
                    key={row.id}
                    style={{
                      justifyContent: "space-between",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderBottomWidth: i < recentRows.length - 1 ? 1 : 0,
                      borderBottomColor: c.border,
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Body style={{ fontSize: 14 }}>{formatDate(row.session_date)}</Body>
                      {row.topic ? (
                        <Body muted style={{ fontSize: 12, marginTop: 1 }} numberOfLines={1}>{row.topic}</Body>
                      ) : null}
                    </View>
                    <Pill label={row.status} tone={statusTone(row.status)} />
                  </Row>
                ))}
              </Card>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}
