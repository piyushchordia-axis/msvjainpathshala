import { Pressable, ScrollView, Text, View } from "react-native";
import { bodyFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { Body } from "@/components/ui";

type Props = {
  /**
   * When true (default), always show who the screen is scoped to — even with a
   * single child. Set false on screens that already render a full child card
   * (e.g. parent home) so the name isn't duplicated when there is only one.
   */
  alwaysShow?: boolean;
};

/**
 * Shows which child every "me" activity screen is scoped to.
 * With multiple children, also offers chips to switch.
 */
export function ChildSwitcher({ alwaysShow = true }: Props) {
  const c = useColors();
  const { hi } = useLocale();
  const { children, activeStudentId, activeChild, setActiveStudentId } = useSessionView();

  if (!activeChild) return null;

  if (children.length <= 1) {
    if (!alwaysShow) return null;
    return (
      <Body muted style={{ marginLeft: 2 }}>
        {activeChild.full_name}
      </Body>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          fontFamily: bodyFamily(hi, "semibold"),
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
                  fontFamily: bodyFamily(hi, "semibold"),
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
