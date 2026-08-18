/**
 * A bottom-anchored list of actions.
 *
 * RN `Modal`, not `@gorhom/bottom-sheet`: LibraryTextSheet records that the
 * bottom-sheet library would not present on iOS and was replaced by exactly
 * this shape, and the course section screen's content modal already uses it.
 * One more hand-rolled sheet is cheaper than a second presentation mechanism
 * that works on one platform.
 */
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, Button, Title } from "@/components/ui";

export type ActionSheetItem = {
  key: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

export function ActionSheet({
  open,
  title,
  items,
  onClose,
}: {
  open: boolean;
  title: string;
  items: ActionSheetItem[];
  onClose: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: c.foreground + "73" }]}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.sheet,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              borderRadius: c.radius,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <Title style={{ fontSize: 17, lineHeight: 26, marginBottom: 4 }}>{title}</Title>

          {/* Scrolls rather than growing: five sources plus a Hindi label set
              would otherwise push Cancel off a short screen. */}
          <ScrollView bounces={false} style={{ maxHeight: 360 }}>
            {items.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => {
                  // Close first: presenting a camera or picker over a live
                  // modal is what makes iOS drop the second presentation.
                  onClose();
                  item.onPress();
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={({ pressed }) => [
                  styles.item,
                  {
                    borderBottomColor: c.border,
                    backgroundColor: pressed ? c.muted : "transparent",
                  },
                ]}
              >
                {item.icon ? (
                  <Ionicons name={item.icon} size={20} color={c.secondary} />
                ) : null}
                <Body style={{ flex: 1, fontSize: 15, lineHeight: 24 }} numberOfLines={2}>
                  {item.label}
                </Body>
              </Pressable>
            ))}
          </ScrollView>

          <View style={{ marginTop: 12 }}>
            <Button
              variant="outline"
              label={hi ? "रद्द करें" : "Cancel"}
              onPress={onClose}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  sheet: {
    padding: 20,
    borderWidth: 1,
    maxHeight: "80%",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
