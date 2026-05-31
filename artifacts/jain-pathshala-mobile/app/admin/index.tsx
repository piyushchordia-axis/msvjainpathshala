import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessAdminPanel } from "@/lib/auth";
import { apiGet } from "@/lib/api";
import type { AdminEnrolment, AnalyticsOverview, ListResponse } from "@/lib/types";
import { formatPaise } from "@/lib/format";
import { Body, Button, Card, Row, Screen, StateView, Title } from "@/components/ui";

export default function DashboardScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { user, loading, logout } = useAuth();

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => apiGet<AnalyticsOverview>("/v1/admin/analytics/overview"),
    enabled: !!user && canAccessAdminPanel(user.role),
  });

  const pending = useQuery({
    queryKey: ["admin-pending-enrolments"],
    queryFn: () => apiGet<ListResponse<AdminEnrolment>>("/v1/admin/enrolments?status=pending&limit=8"),
    enabled: !!user && canAccessAdminPanel(user.role),
  });

  if (loading) return <Screen scroll={false}><StateView status="loading" emptyText="" /></Screen>;
  if (!user || !canAccessAdminPanel(user.role)) return <Redirect href="/admin/login" />;

  const o = overview.data;
  const stats = [
    { label: hi ? "सक्रिय विद्यार्थी" : "Active students", value: o?.active_students ?? 0, icon: "people-outline" as const },
    { label: hi ? "केंद्र" : "Centres", value: o?.centres ?? 0, icon: "business-outline" as const },
    { label: hi ? "30-दिन उपस्थिति" : "30-day attendance", value: o ? `${o.attendance_rate_30d}%` : "—", icon: "checkmark-done-outline" as const },
    { label: hi ? "पुण्य (30 दिन)" : "Punya awarded", value: o?.punya_awarded_30d ?? 0, icon: "ribbon-outline" as const },
    { label: hi ? "एमएसवी सक्रिय" : "MSV approved", value: o?.msv_active ?? 0, icon: "leaf-outline" as const },
    { label: hi ? "दान (वर्ष)" : "Donations YTD", value: formatPaise(o?.donations_total_paise_ytd), icon: "heart-outline" as const },
  ];

  const modules = [
    { label: hi ? "विद्यार्थी" : "Students", href: "/admin/students" as const, icon: "people-outline" as const },
    { label: hi ? "नामांकन" : "Enrolments", href: "/admin/enrolments" as const, icon: "clipboard-outline" as const },
    { label: hi ? "बैच" : "Batches", href: "/admin/batches" as const, icon: "grid-outline" as const },
    { label: hi ? "सभी मॉड्यूल" : "All modules", href: "/admin/modules" as const, icon: "apps-outline" as const },
  ];

  return (
    <Screen refreshing={overview.isRefetching} onRefresh={() => { overview.refetch(); pending.refetch(); }}>
      <Title style={{ fontSize: 22 }}>{hi ? "नमस्ते" : "Good morning"}, {user.full_name.split(" ")[0]}</Title>

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
          {pending.data ? <Body muted>{pending.data.items.length}</Body> : null}
        </Row>
        <Body muted style={{ marginTop: 4, fontSize: 13 }}>{hi ? "लंबित नामांकन" : "Pending enrolments"}</Body>
        <Button label={hi ? "नामांकन देखें" : "Review enrolments"} variant="outline" icon="arrow-forward" onPress={() => router.push("/admin/enrolments")} style={{ marginTop: 14 }} />
      </Card>

      <Title style={{ fontSize: 16, marginLeft: 2 }}>{hi ? "प्रबंधन" : "Manage"}</Title>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {modules.map((m, i) => (
          <Pressable key={m.href} onPress={() => router.push(m.href)}>
            {({ pressed }) => (
              <Row style={{ paddingVertical: 14, paddingHorizontal: 14, opacity: pressed ? 0.7 : 1, borderBottomWidth: i < modules.length - 1 ? 1 : 0, borderBottomColor: c.border }}>
                <Ionicons name={m.icon} size={19} color={c.primary} />
                <Body style={{ flex: 1, marginLeft: 12, fontSize: 15 }}>{m.label}</Body>
                <Ionicons name="chevron-forward" size={18} color={c.inkDim} />
              </Row>
            )}
          </Pressable>
        ))}
      </Card>

      <Button label={hi ? "साइन आउट" : "Sign out"} variant="ghost" icon="log-out-outline" onPress={() => { logout(); router.replace("/(tabs)"); }} />
    </Screen>
  );
}
