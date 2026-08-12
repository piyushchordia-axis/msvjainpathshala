import { Modal, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  cityDisplayName,
  PANCHANG_CITIES,
  type PanchangCity,
} from "@/lib/panchang/cities";
import { Body, Row, Title } from "@/components/ui";

export function PanchangCityPicker({
  visible,
  selectedKey,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selectedKey: string;
  onSelect: (city: PanchangCity) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            maxHeight: "70%",
            backgroundColor: c.background,
            borderTopLeftRadius: c.radius,
            borderTopRightRadius: c.radius,
            paddingBottom: 24,
          }}
        >
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
            <Title style={{ fontSize: 18, lineHeight: 26 }}>
              {hi ? "शहर चुनें" : "Choose city"}
            </Title>
            <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 20 }}>
              {hi
                ? "पच्चक्खाण समय इसी शहर के सूर्योदय/सूर्यास्त से गणना होते हैं।"
                : "Pachchakkhan times use sunrise/sunset for this city."}
            </Body>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 16 }}>
            {PANCHANG_CITIES.map((city) => {
              const selected = city.key === selectedKey;
              return (
                <Pressable
                  key={city.key}
                  onPress={() => {
                    onSelect(city);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: selected ? c.accent : "transparent",
                  }}
                >
                  <Row style={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Title style={{ fontSize: 16, lineHeight: 22 }}>
                      {cityDisplayName(city, hi)}
                    </Title>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={22} color={c.primary} />
                    ) : null}
                  </Row>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
