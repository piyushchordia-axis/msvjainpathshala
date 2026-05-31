import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessAdminPanel } from "@/lib/auth";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

interface ModuleRow {
  en: string;
  hi: string;
  icon: keyof typeof Ionicons.glyphMap;
  href?: Href;
}

const MODULES: ModuleRow[] = [
  { en: "Students", hi: "विद्यार्थी", icon: "people-outline", href: "/admin/students" },
  { en: "Enrolments", hi: "नामांकन", icon: "clipboard-outline", href: "/admin/enrolments" },
  { en: "Batches", hi: "बैच", icon: "grid-outline", href: "/admin/batches" },
  { en: "Analytics", hi: "विश्लेषण", icon: "bar-chart-outline" },
  { en: "MSV enrolments", hi: "एमएसवी नामांकन", icon: "leaf-outline" },
  { en: "Shikshaks", hi: "शिक्षक", icon: "school-outline" },
  { en: "Curriculum", hi: "पाठ्यक्रम", icon: "book-outline" },
  { en: "Exams", hi: "परीक्षाएँ", icon: "create-outline" },
  { en: "Niyams", hi: "नियम", icon: "checkmark-circle-outline" },
  { en: "Punya", hi: "पुण्य", icon: "ribbon-outline" },
  { en: "Shivirs", hi: "शिविर", icon: "bonfire-outline" },
  { en: "Notices", hi: "सूचनाएँ", icon: "notifications-outline" },
  { en: "Gallery", hi: "गैलरी", icon: "images-outline" },
  { en: "Library", hi: "पुस्तकालय", icon: "library-outline" },
  { en: "Donations", hi: "दान", icon: "heart-outline" },
  { en: "Audit", hi: "ऑडिट", icon: "shield-checkmark-outline" },
];

export default function ModulesScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { user, loading } = useAuth();

  if (loading) return <Screen scroll={false}><StateView status="loading" emptyText="" /></Screen>;
  if (!user || !canAccessAdminPanel(user.role)) return <Redirect href="/admin/login" />;

  return (
    <Screen>
      <Body muted>{hi ? "व्यवस्थापक पैनल मॉड्यूल" : "Admin panel modules"}</Body>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {MODULES.map((m, i) => (
          <Pressable key={m.en} onPress={() => m.href && router.push(m.href)} disabled={!m.href}>
            {({ pressed }) => (
              <Row style={{ paddingVertical: 14, paddingHorizontal: 14, opacity: pressed && m.href ? 0.7 : 1, borderBottomWidth: i < MODULES.length - 1 ? 1 : 0, borderBottomColor: c.border }}>
                <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={m.icon} size={18} color={c.primary} />
                </View>
                <Body style={{ flex: 1, marginLeft: 12, fontSize: 15 }}>{hi ? m.hi : m.en}</Body>
                {m.href ? <Ionicons name="chevron-forward" size={18} color={c.inkDim} /> : <Pill label={hi ? "जल्द" : "Soon"} />}
              </Row>
            )}
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
