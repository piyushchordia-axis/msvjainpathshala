/**
 * MSV programme — apply and track status.
 *
 * POST /v1/msv/apply and GET /v1/msv/mine were fully built and guarded but had
 * NO client surface: a parent could not apply, and a child whose application was
 * pending or rejected saw nothing at all (only an `approved` pill rendered on the
 * home screen). This is that surface.
 *
 * Q1 — MSV approval is purely admin discretion. There is deliberately NO
 * eligibility check, age gate or score threshold here: the form states what it
 * is, submits, and shows the admin's decision when it arrives.
 */
import { useCallback } from "react";
import { Alert, View } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { apiGet, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

type MsvEnrolment = {
  id: string;
  status: string;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
};

type MsvChild = {
  id: string;
  full_name: string;
  student_code: string;
  msv_status: string | null;
  latest_enrolment: MsvEnrolment | null;
  msv_curriculum: { id: string; name: string; academic_year: string } | null;
};

function statusCopy(status: string | null | undefined, hi: boolean) {
  switch (status) {
    case "approved":
      return { label: hi ? "स्वीकृत" : "Approved", tone: "success" as const };
    case "applied":
      return { label: hi ? "विचाराधीन" : "Under review", tone: "warning" as const };
    case "waitlisted":
      return { label: hi ? "प्रतीक्षा सूची" : "Waitlisted", tone: "warning" as const };
    case "rejected":
      return { label: hi ? "अस्वीकृत" : "Not accepted", tone: "error" as const };
    case "revoked":
      return { label: hi ? "वापस लिया गया" : "Withdrawn", tone: "neutral" as const };
    default:
      return { label: hi ? "आवेदन नहीं किया" : "Not applied", tone: "neutral" as const };
  }
}

export default function MsvScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const qc = useQueryClient();
  const { activeStudentId, loading: sessionLoading } = useSessionView();

  const mine = useQuery({
    queryKey: ["me", "msv"],
    queryFn: () => apiGet<{ items: MsvChild[] }>("/v1/msv/mine"),
  });

  const apply = useMutation({
    mutationFn: (studentId: string) => apiPost<{ id: string }>("/v1/msv/apply", { student_id: studentId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me", "msv"] });
      Alert.alert(
        hi ? "आवेदन भेजा गया" : "Application sent",
        hi
          ? "आपका आवेदन भेज दिया गया है। निर्णय आने पर यहाँ दिखेगा।"
          : "Your application has been sent. The decision will appear here.",
      );
    },
    onError: (err) =>
      Alert.alert(
        hi ? "आवेदन नहीं भेजा जा सका" : "Couldn't send the application",
        apiErrorMessage(err, hi, {
          ERR_CONFLICT: {
            en: "There is already an open application for this child.",
            hi: "इस बच्चे के लिए पहले से एक आवेदन विचाराधीन है।",
          },
        }),
      ),
  });

  const onApply = useCallback(
    (child: MsvChild) => {
      Alert.alert(
        hi ? "MSV के लिए आवेदन करें?" : "Apply for MSV?",
        hi
          ? `${child.full_name} के लिए आवेदन भेजा जाएगा। स्वीकृति व्यवस्थापक के विवेक पर है।`
          : `An application will be sent for ${child.full_name}. Acceptance is at the administrator's discretion.`,
        [
          { text: hi ? "रद्द करें" : "Cancel", style: "cancel" },
          { text: hi ? "आवेदन करें" : "Apply", onPress: () => apply.mutate(child.id) },
        ],
      );
    },
    [apply, hi],
  );

  const items = mine.data?.items ?? [];
  const active = activeStudentId ? items.find((i) => i.id === activeStudentId) ?? null : null;
  const shown = active ? [active] : items;

  // No dedicated MSV accent token exists; MSV approval enrols the student
  // into the MSV curriculum, so it sits in the courses domain.
  return (
    <ActivityThemed accent="courses">
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <AppHeader
          title={hi ? "MSV कार्यक्रम" : "MSV programme"}
          subtitle={hi ? "आवेदन और स्थिति" : "Apply and track status"}
        />
        <Screen>
          <ChildSwitcher />

          {sessionLoading || mine.isLoading ? (
            <StateView status="loading" emptyText="" />
          ) : mine.isError ? (
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "जानकारी लोड नहीं हो सकी।" : "Could not load MSV details."}
              onRetry={() => void mine.refetch()}
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          ) : shown.length === 0 ? (
            <StateView
              status="empty"
              emptyText={hi ? "कोई बच्चा नहीं मिला।" : "No children found."}
            />
          ) : (
            shown.map((child) => {
              const enrolment = child.latest_enrolment;
              const status = statusCopy(child.msv_status ?? enrolment?.status, hi);
              // Re-application is allowed from these states (server-enforced).
              const canApply =
                !child.msv_status ||
                ["rejected", "revoked", "waitlisted", "none"].includes(child.msv_status);

              return (
                <Card key={child.id} style={{ marginTop: 14 }}>
                  <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Title style={{ fontSize: 16 }}>{child.full_name}</Title>
                      <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                        {child.student_code}
                      </Body>
                    </View>
                    <Pill label={status.label} tone={status.tone} />
                  </Row>

                  {enrolment ? (
                    <Body muted style={{ fontSize: 12, marginTop: 10 }}>
                      {hi ? "आवेदन तिथि: " : "Applied: "}
                      {formatDate(enrolment.created_at)}
                    </Body>
                  ) : null}

                  {/* The admin's own words, where they gave a reason. */}
                  {enrolment?.reason ? (
                    <Body style={{ fontSize: 13, marginTop: 8 }}>
                      {hi ? "टिप्पणी: " : "Note: "}
                      {enrolment.reason}
                    </Body>
                  ) : null}

                  {child.msv_curriculum ? (
                    <Body muted style={{ fontSize: 12, marginTop: 8 }}>
                      {hi ? "पाठ्यक्रम: " : "Curriculum: "}
                      {child.msv_curriculum.name} · {child.msv_curriculum.academic_year}
                    </Body>
                  ) : null}

                  {canApply ? (
                    <Button
                      label={hi ? "MSV के लिए आवेदन करें" : "Apply for MSV"}
                      onPress={() => onApply(child)}
                      disabled={apply.isPending}
                      style={{ marginTop: 14 }}
                    />
                  ) : null}
                </Card>
              );
            })
          )}
        </Screen>
      </View>
    </ActivityThemed>
  );
}
