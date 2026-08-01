import { View } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAttendance, usePunya } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { GalleryCarousel } from "@/components/GalleryCarousel";
import { AnimatedMount } from "@/components/AnimatedMount";
import { Body, Button, Card, Kicker, Numeric, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { QuickActions } from "@/components/QuickActions";
import { formatAgeGroup } from "@workspace/api-zod";

export default function ParentHome() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const router = useRouter();
  const {
    children,
    loading,
    isError,
    activeStudentId,
    activeChild,
    refetch,
  } = useSessionView();

  const attendance = useAttendance(activeStudentId ?? undefined);
  const punya = usePunya(activeStudentId ?? undefined);

  const firstName = user?.full_name?.split(" ")[0] ?? "";

  const onRefresh = () => {
    refetch();
    attendance.refetch();
    punya.refetch();
  };

  const rows = attendance.data?.items ?? [];
  const recent = rows.slice(0, 5);
  const presentCount = rows.filter((r) => r.status.toLowerCase() === "present").length;
  const presentRate = rows.length > 0 ? Math.round((presentCount / rows.length) * 100) : 0;

  function attendanceTone(status: string): "success" | "warning" | "neutral" {
    const s = status.toLowerCase();
    if (s === "present") return "success";
    if (s === "absent") return "warning";
    return "neutral";
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? `नमस्ते, ${firstName}` : `Namaste, ${firstName}`}
        subtitle={hi ? "अपने बच्चे की प्रगति देखें" : "Track your child's progress"}
      />
      <Screen
        refreshing={attendance.isRefetching || punya.isRefetching}
        onRefresh={onRefresh}
        contentStyle={{ paddingBottom: 110 }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "जानकारी लोड नहीं हुई।" : "Could not load your children."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : children.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपके खाते से कोई बच्चा जुड़ा नहीं है।"
                : "No children linked to your account yet."
            }
          />
        ) : (
          <>
            <AnimatedMount delay={0}>
              <GalleryCarousel />
            </AnimatedMount>

            <ChildSwitcher alwaysShow={false} />

            {activeChild ? (
              <AnimatedMount delay={60}>
                <Card>
                  <Kicker>{hi ? "बच्चा" : "Child"}</Kicker>
                  <Title style={{ fontSize: 20, marginTop: 4 }}>{activeChild.full_name}</Title>
                  <Body muted style={{ marginTop: 2 }}>
                    {activeChild.student_code} · {formatAgeGroup(activeChild.age_group, hi ? "hi" : "en")}
                  </Body>
                  {activeChild.centre_name ? (
                    <Body style={{ marginTop: 8 }}>{activeChild.centre_name}</Body>
                  ) : null}
                  {activeChild.batch_name ? (
                    <Body muted style={{ marginTop: 2 }}>{activeChild.batch_name}</Body>
                  ) : null}
                  <Row style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <Pill
                      label={
                        hi
                          ? `${activeChild.total_points} अंक`
                          : `${activeChild.total_points} pts`
                      }
                      tone="primary"
                    />
                    <Pill label={activeChild.tier} tone="info" />
                    {activeChild.msv_status && activeChild.msv_status !== "none" ? (
                      <Pill
                        label={`MSV: ${activeChild.msv_status}`}
                        tone="neutral"
                      />
                    ) : null}
                  </Row>
                  <Button
                    label={hi ? "पहचान पत्र" : "ID Card"}
                    icon="card-outline"
                    variant="outline"
                    style={{ marginTop: 14 }}
                    onPress={() => router.push("/idcard")}
                  />
                </Card>
              </AnimatedMount>
            ) : null}

            <AnimatedMount delay={120}>
              <QuickActions />
            </AnimatedMount>

            <AnimatedMount delay={180}>
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Title style={{ fontSize: 17 }}>{hi ? "उपस्थिति" : "Attendance"}</Title>
                  {rows.length > 0 ? (
                    <Pill
                      label={
                        hi ? `${presentRate}% उपस्थित` : `${presentRate}% present`
                      }
                      tone={presentRate >= 75 ? "success" : "warning"}
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
                ) : recent.length === 0 ? (
                  <Body muted style={{ marginTop: 10 }}>
                    {hi ? "अभी कोई उपस्थिति दर्ज नहीं है।" : "No attendance recorded yet."}
                  </Body>
                ) : (
                  <View style={{ gap: 10, marginTop: 12 }}>
                    {recent.map((r) => (
                      <View
                        key={r.id}
                        style={{
                          borderTopWidth: 1,
                          borderTopColor: c.border,
                          paddingTop: 10,
                        }}
                      >
                        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                          <Body style={{ fontWeight: "600" }}>{formatDate(r.session_date)}</Body>
                          <Pill label={r.status} tone={attendanceTone(r.status)} />
                        </Row>
                        {r.topic ? (
                          <Body muted style={{ marginTop: 2 }}>{r.topic}</Body>
                        ) : null}
                        {r.batch_name ? (
                          <Body muted style={{ marginTop: 2, fontSize: 13 }}>{r.batch_name}</Body>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}
              </Card>
            </AnimatedMount>

            <AnimatedMount delay={240}>
              <Card>
                <Title style={{ fontSize: 17 }}>{hi ? "पुण्य अंक" : "Punya points"}</Title>
                {punya.isLoading ? (
                  <StateView status="loading" emptyText="" />
                ) : punya.isError ? (
                  <StateView
                    status="error"
                    emptyText=""
                    errorText={hi ? "पुण्य लोड नहीं हुआ।" : "Could not load punya."}
                    onRetry={punya.refetch}
                    retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
                  />
                ) : (
                  <Row style={{ gap: 10, marginTop: 12, alignItems: "center" }}>
                    <Numeric style={{ fontSize: 28 }} countUp>
                      {punya.data?.total_points ?? 0}
                    </Numeric>
                    <Body muted>{hi ? "कुल अंक" : "total points"}</Body>
                    {punya.data?.tier ? (
                      <View style={{ marginLeft: "auto" }}>
                        <Pill label={punya.data.tier} tone="primary" />
                      </View>
                    ) : null}
                  </Row>
                )}
              </Card>
            </AnimatedMount>
          </>
        )}
      </Screen>
    </View>
  );
}
