import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useOverview } from "@/lib/queries";
import { formatPaise } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Row, Screen, StateView, Title } from "@/components/ui";

export default function DashboardScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { user } = useAuth();
  const { data, isLoading, isError, refetch, isRefetching } = useOverview();

  const stats = [
    { label: hi ? "सक्रिय विद्यार्थी" : "Active students", value: data?.active_students ?? 0, icon: "people-outline" as const },
    { label: hi ? "केंद्र" : "Centres", value: data?.centres ?? 0, icon: "business-outline" as const },
    { label: hi ? "30-दिन उपस्थिति" : "30-day attendance", value: data ? `${data.attendance_rate_30d}%` : "—", icon: "checkmark-done-outline" as const },
    { label: hi ? "पुण्य (30 दिन)" : "Punya awarded", value: data?.punya_awarded_30d ?? 0, icon: "ribbon-outline" as const },
    { label: hi ? "एमएसवी सक्रिय" : "MSV active", value: data?.msv_active ?? 0, icon: "leaf-outline" as const },
    { label: hi ? "दान (वर्ष)" : "Donations YTD", value: formatPaise(data?.donations_total_paise_ytd), icon: "heart-outline" as const },
  ];

  const firstName = user?.full_name?.split(" ")[0] ?? "";

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={`${hi ? "नमस्ते" : "Namaste"}, ${firstName}`}
        subtitle={hi ? "संगठन का अवलोकन" : "Organisation overview"}
      />
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "अवलोकन लोड नहीं हुआ।" : "Could not load the overview."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {stats.map((s) => (
                <Card key={s.label} style={{ width: "47%" }}>
                  <Ionicons name={s.icon} size={20} color={c.primary} />
                  <Title style={{ fontSize: 24, marginTop: 8 }}>{s.value}</Title>
                  <Body muted style={{ fontSize: 12, marginTop: 2 }}>{s.label}</Body>
                </Card>
              ))}
            </View>

            <Card>
              <Row style={{ justifyContent: "space-between" }}>
                <Title style={{ fontSize: 17 }}>{hi ? "आपकी स्वीकृति की प्रतीक्षा" : "Awaiting your approval"}</Title>
                <Ionicons name="clipboard-outline" size={20} color={c.primary} />
              </Row>
              <Body muted style={{ marginTop: 4, fontSize: 13 }}>{hi ? "लंबित नामांकनों की समीक्षा करें" : "Review pending enrolments"}</Body>
              <Button
                label={hi ? "नामांकन देखें" : "Review enrolments"}
                variant="outline"
                icon="arrow-forward"
                onPress={() => router.push("/admin/enrolments")}
                style={{ marginTop: 14 }}
              />
            </Card>
          </>
        )}
      </Screen>
    </View>
  );
}
