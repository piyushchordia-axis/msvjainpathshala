import { Alert, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminStudents, useStudentStatusAction } from "@/lib/queries";
import type { AdminStudentRow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { formatAgeGroup } from "@workspace/api-zod";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function StudentsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminStudents();
  const mutate = useStudentStatusAction();

  const items = data?.items ?? [];

  const confirm = (s: AdminStudentRow) => {
    const deactivate = s.status === "active";
    Alert.alert(
      deactivate ? (hi ? "निष्क्रिय करें?" : "Deactivate?") : (hi ? "पुनः सक्रिय करें?" : "Reactivate?"),
      s.full_name ?? s.student_code,
      [
        { text: hi ? "रद्द" : "Cancel", style: "cancel" },
        {
          text: hi ? "पुष्टि" : "Confirm",
          style: deactivate ? "destructive" : "default",
          onPress: () =>
            mutate.mutate(
              { id: s.id, action: deactivate ? "deactivate" : "reactivate" },
              { onError: (e) => Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed") },
            ),
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "विद्यार्थी" : "Students"}
        subtitle={hi ? "आपके केंद्रों की सूची" : "Roster across your centres"}
      />
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "विद्यार्थी लोड नहीं हुए।" : "Could not load students."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "कोई विद्यार्थी नहीं मिला।" : "No students found."} />
        ) : (
          items.map((s) => (
            <Card key={s.id}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Title style={{ fontSize: 17 }}>{s.full_name ?? s.student_code}</Title>
                  <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                    {[s.student_code, formatAgeGroup(s.age_group, hi ? "hi" : "en")].filter(Boolean).join(" · ") || "—"}
                  </Body>
                </View>
                <Pill tone={s.status === "active" ? "success" : "neutral"} label={s.status} />
              </Row>
              <Row style={{ gap: 8, marginTop: 8 }}>
                {s.dob ? <Body muted style={{ fontSize: 12 }}>{hi ? "जन्म" : "DOB"}: {formatDate(s.dob)}</Body> : null}
                {s.msv_status && s.msv_status !== "none" ? (
                  <Pill label={`MSV: ${s.msv_status}`} />
                ) : null}
              </Row>
              <Button
                label={s.status === "active" ? (hi ? "निष्क्रिय करें" : "Deactivate") : (hi ? "पुनः सक्रिय करें" : "Reactivate")}
                variant={s.status === "active" ? "outline" : "secondary"}
                onPress={() => confirm(s)}
                loading={mutate.isPending && mutate.variables?.id === s.id}
                style={{ marginTop: 12 }}
              />
            </Card>
          ))
        )}
      </Screen>
    </View>
  );
}
