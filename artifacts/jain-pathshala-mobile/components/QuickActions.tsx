import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Card, Body, Title } from "@/components/ui";

type Action = { href: string; icon: keyof typeof Ionicons.glyphMap; en: string; hi: string };

const ACTIONS: Action[] = [
  { href: "/notifications", icon: "notifications-outline", en: "Notifications", hi: "सूचनाएँ" },
  { href: "/niyam-submit", icon: "sparkles-outline", en: "Submit Niyam", hi: "नियम भेजें" },
  { href: "/homework", icon: "book-outline", en: "Homework", hi: "गृहकार्य" },
  { href: "/quizzes", icon: "help-circle-outline", en: "Quizzes", hi: "प्रश्नोत्तरी" },
  { href: "/competitions", icon: "trophy-outline", en: "Competitions", hi: "प्रतियोगिताएँ" },
  { href: "/idcard", icon: "card-outline", en: "ID Card", hi: "पहचान पत्र" },
];

/** A grid of quick links to the student/parent activity screens. */
export function QuickActions() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  return (
    <Card>
      <Title style={{ fontSize: 16, marginBottom: 12 }}>{hi ? "गतिविधियाँ" : "Activities"}</Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {ACTIONS.map((a) => (
          <Pressable
            key={a.href}
            onPress={() => router.push(a.href as never)}
            style={{
              width: "30%",
              alignItems: "center",
              paddingVertical: 14,
              borderRadius: c.radius ?? 12,
              backgroundColor: c.muted,
            }}
          >
            <Ionicons name={a.icon} size={26} color={c.primary} />
            <Body style={{ fontSize: 11, marginTop: 6, textAlign: "center" }}>{hi ? a.hi : a.en}</Body>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
