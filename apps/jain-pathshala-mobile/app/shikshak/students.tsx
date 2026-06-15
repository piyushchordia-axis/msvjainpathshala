import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminStudents } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function StudentsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminStudents();
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "मेरे विद्यार्थी" : "My students"} />
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
                    {[s.student_code, s.age_group].filter(Boolean).join(" · ") || "—"}
                  </Body>
                </View>
                <Pill tone={s.status === "active" ? "success" : "neutral"} label={s.status} />
              </Row>
              <Row style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {s.dob ? (
                  <Body muted style={{ fontSize: 12 }}>
                    {hi ? "जन्म" : "DOB"}: {formatDate(s.dob)}
                  </Body>
                ) : null}
                {s.msv_status ? <Pill label={`MSV: ${s.msv_status}`} /> : null}
              </Row>
            </Card>
          ))
        )}
      </Screen>
    </View>
  );
}
