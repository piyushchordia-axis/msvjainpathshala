import { View } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAttendance, usePunya } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { GalleryCarousel } from "@/components/GalleryCarousel";
import { AnimatedMount } from "@/components/AnimatedMount";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { QuickActions } from "@/components/QuickActions";

export default function StudentHome() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const router = useRouter();
  const { activeChild, activeStudentId, loading, isError, refetch } = useSessionView();

  const attendance = useAttendance(activeStudentId ?? undefined);
  const punya = usePunya(activeStudentId ?? undefined);

  const firstName = user?.full_name?.split(" ")[0] ?? (hi ? "विद्यार्थी" : "Student");

  const attendanceRows = attendance.data?.items ?? [];
  const recentRows = attendanceRows.slice(0, 2);
  const hasMoreAttendance = attendanceRows.length > 2;
  // AT5 — server SQL only.
  const presentRate =
    attendance.data?.attendance_percent ??
    (attendance.data?.attendance_rate != null
      ? Math.round(attendance.data.attendance_rate * 100)
      : null);

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
            <AnimatedMount delay={0}>
              <GalleryCarousel />
            </AnimatedMount>

            <AnimatedMount delay={60}>
              <QuickActions />
            </AnimatedMount>

            <AnimatedMount delay={120}>
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Body muted style={{ fontSize: 12 }}>
                      {hi ? "विद्यार्थी आईडी" : "Student ID"}
                    </Body>
                    <Title style={{ fontSize: 20, marginTop: 2 }}>{activeChild.student_code}</Title>
                  </View>
                  <Button
                    label={hi ? "पहचान पत्र" : "ID Card"}
                    icon="card-outline"
                    variant="outline"
                    onPress={() => router.push("/idcard")}
                  />
                </Row>
                {activeChild.centre_name ? (
                  <Body style={{ marginTop: 12 }}>{activeChild.centre_name}</Body>
                ) : null}
                <Row style={{ gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <Pill
                    label={
                      hi
                        ? `${activeChild.total_points} पुण्य`
                        : `${activeChild.total_points} punya`
                    }
                    tone="primary"
                  />
                  {activeChild.tier ? (
                    <Pill label={activeChild.tier} tone="info" />
                  ) : null}
                  {activeChild.msv_status === "approved" ? (
                    <Pill label="MSV" tone="neutral" />
                  ) : null}
                </Row>
              </Card>
            </AnimatedMount>

            <AnimatedMount delay={180}>
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
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
                  <Body muted style={{ marginTop: 10 }}>
                    {hi ? "अभी कोई उपस्थिति दर्ज नहीं है।" : "No attendance recorded yet."}
                  </Body>
                ) : (
                  <View style={{ marginTop: 12 }}>
                    {recentRows.map((row, i) => (
                      <Row
                        key={row.id}
                        style={{
                          justifyContent: "space-between",
                          paddingVertical: 10,
                          borderTopWidth: i === 0 ? 0 : 1,
                          borderTopColor: c.border,
                        }}
                      >
                        <View style={{ flex: 1, paddingRight: 10 }}>
                          <Body style={{ fontSize: 14 }}>{formatDate(row.session_date)}</Body>
                          {row.topic ? (
                            <Body muted style={{ fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                              {row.topic}
                            </Body>
                          ) : null}
                        </View>
                        <Pill label={row.status} tone={statusTone(row.status)} />
                      </Row>
                    ))}
                    {hasMoreAttendance ? (
                      <Button
                        label={hi ? "और देखें →" : "View more →"}
                        variant="ghost"
                        style={{ marginTop: 4, alignSelf: "flex-start" }}
                        onPress={() => router.push("/my-attendance")}
                      />
                    ) : null}
                  </View>
                )}
              </Card>
            </AnimatedMount>
          </>
        )}
      </Screen>
    </View>
  );
}
