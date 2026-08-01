import { View, Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Card, Body, Title } from "@/components/ui";

type Action = { href: string; icon: keyof typeof Ionicons.glyphMap; en: string; hi: string };

const ACTIONS: Action[] = [
  { href: "/notifications", icon: "notifications-outline", en: "Notifications", hi: "सूचनाएँ" },
  { href: "/my-attendance", icon: "checkmark-done-outline", en: "Attendance", hi: "उपस्थिति" },
  { href: "/niyam-submit", icon: "sparkles-outline", en: "Submit Niyam", hi: "नियम भेजें" },
  { href: "/homework", icon: "book-outline", en: "Homework", hi: "गृहकार्य" },
  { href: "/quizzes", icon: "help-circle-outline", en: "Quizzes", hi: "प्रश्नोत्तरी" },
  { href: "/exams", icon: "clipboard-outline", en: "Exams", hi: "परीक्षाएँ" },
  { href: "/competitions", icon: "trophy-outline", en: "Competitions", hi: "प्रतियोगिताएँ" },
];

function ActionTile({ action }: { action: Action }) {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withTiming(0.94, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 120 });
      }}
      onPress={() => {
        if (Platform.OS !== "web") {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        router.push(action.href as never);
      }}
      style={{ width: "30%" }}
    >
      <Animated.View
        style={[
          {
            alignItems: "center",
            paddingVertical: 14,
            borderRadius: c.radius ?? 12,
            backgroundColor: c.muted,
          },
          animStyle,
        ]}
      >
        <Ionicons name={action.icon} size={26} color={c.primary} />
        <Body style={{ fontSize: 11, marginTop: 6, textAlign: "center" }}>
          {hi ? action.hi : action.en}
        </Body>
      </Animated.View>
    </Pressable>
  );
}

/** A grid of quick links to the student/parent activity screens. */
export function QuickActions() {
  const { hi } = useLocale();
  return (
    <Card>
      <Title style={{ fontSize: 16, marginBottom: 12 }}>{hi ? "गतिविधियाँ" : "Activities"}</Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {ACTIONS.map((a) => (
          <ActionTile key={a.href} action={a} />
        ))}
      </View>
    </Card>
  );
}
