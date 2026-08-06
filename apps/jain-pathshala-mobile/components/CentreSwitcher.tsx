import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";

export type CentreOption = { centre_id: string; centre_name: string };

/**
 * Horizontal centre chips with AsyncStorage persistence.
 * Used by Sanchalak staffing / holidays screens (key `jp.sanchalak.selectedCentreId`).
 */
export function CentreSwitcher({
  centres,
  storageKey,
  selectedId,
  onChange,
}: {
  centres: CentreOption[];
  storageKey: string;
  selectedId: string | null;
  onChange: (id: string) => void;
}) {
  const c = useColors();
  const { hi } = useLocale();

  if (centres.length <= 1) return null;

  return (
    <View style={{ gap: 8, marginBottom: 12 }}>
      <Text
        style={{
          fontFamily: bodyFamily(hi, "semibold"),
          fontSize: 12,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: c.mutedForeground,
        }}
      >
        {hi ? "केंद्र चुनें" : "Centre"}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 4 }}
      >
        {centres.map((centre) => {
          const active = centre.centre_id === selectedId;
          return (
            <Pressable
              key={centre.centre_id}
              onPress={() => onChange(centre.centre_id)}
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
                  lineHeight: 22,
                  color: active ? c.primaryForeground : c.mutedForeground,
                }}
              >
                {centre.centre_name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Persist + validate selected centre against the available list. */
export function usePersistedCentreId(
  centres: CentreOption[],
  storageKey: string,
): [string | null, (id: string) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(storageKey).then((stored) => {
      if (stored) setSelectedId(stored);
    });
  }, [storageKey]);

  useEffect(() => {
    if (centres.length === 0) return;
    const stillValid = selectedId && centres.some((x) => x.centre_id === selectedId);
    if (!stillValid) {
      const next = centres[0]!.centre_id;
      setSelectedId(next);
      void AsyncStorage.setItem(storageKey, next);
    }
  }, [centres, selectedId, storageKey]);

  function pick(id: string) {
    setSelectedId(id);
    void AsyncStorage.setItem(storageKey, id);
  }

  return [selectedId, pick];
}
