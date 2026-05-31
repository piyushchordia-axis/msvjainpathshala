import { Pressable, ScrollView, Text, View } from "react-native";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";

/**
 * Horizontal chips letting a parent switch which child every "me" screen is
 * scoped to. Hidden when there is only one child (e.g. the student persona).
 */
export function ChildSwitcher() {
  const c = useColors();
  const { hi } = useLocale();
  const { children, activeStudentId, setActiveStudentId } = useSessionView();

  if (children.length <= 1) return null;

  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          fontFamily: fonts.bodySemiBold,
          fontSize: 12,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: c.mutedForeground,
        }}
      >
        {hi ? "बच्चा चुनें" : "Viewing"}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 4 }}
      >
        {children.map((child) => {
          const active = child.id === activeStudentId;
          return (
            <Pressable
              key={child.id}
              onPress={() => setActiveStudentId(child.id)}
              style={{
                backgroundColor: active ? c.primary : c.muted,
                borderRadius: 999,
                paddingHorizontal: 16,
                paddingVertical: 9,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.bodySemiBold,
                  fontSize: 14,
                  color: active ? c.primaryForeground : c.mutedForeground,
                }}
              >
                {child.full_name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
