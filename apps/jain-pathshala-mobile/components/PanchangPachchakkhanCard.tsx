import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { cityDisplayName, type PanchangCity } from "@/lib/panchang/cities";
import { derivePachchakkhan } from "@/lib/panchang/pachchakkhan";
import { formatTimeIst } from "@/lib/panchang/solar";
import type { SunriseSunsetSource } from "@/lib/panchang/sun-override";
import { Body, Card, Row, Title } from "@/components/ui";

export function PanchangPachchakkhanCard({
  city,
  sunriseMs,
  sunsetMs,
  source,
  onChangeCity,
}: {
  city: PanchangCity;
  sunriseMs: number;
  sunsetMs: number;
  source: SunriseSunsetSource;
  onChangeCity: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const slots = derivePachchakkhan(sunriseMs, sunsetMs);
  const cityName = cityDisplayName(city, hi);
  const caption =
    source === "override"
      ? hi
        ? "आधिकारिक समय"
        : "Official timings"
      : hi
        ? `गणना · ${cityName}`
        : `Calculated for ${cityName}`;

  return (
    <View style={{ marginTop: 20 }}>
      <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Title style={{ fontSize: 16, lineHeight: 22 }}>
          {hi ? "पच्चक्खाण" : "Pachchakkhan"}
        </Title>
        <Pressable
          onPress={onChangeCity}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={hi ? "शहर बदलें" : "Change city"}
        >
          <Row style={{ alignItems: "center", gap: 4 }}>
            <Ionicons name="location-outline" size={16} color={c.primary} />
            <Body style={{ fontSize: 13, lineHeight: 20, color: c.primary }}>
              {cityName}
            </Body>
            <Body muted style={{ fontSize: 13, lineHeight: 20 }}>
              {hi ? "बदलें" : "Change"}
            </Body>
          </Row>
        </Pressable>
      </Row>

      <Card>
        <Body muted style={{ fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
          {caption}
        </Body>
        {slots.map((slot, i) => (
          <Row
            key={slot.key}
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              paddingVertical: 8,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: c.border,
            }}
          >
            <Title style={{ fontSize: 15, lineHeight: 22 }}>{slot.label}</Title>
            <Body style={{ fontSize: 15, lineHeight: 22 }}>
              {formatTimeIst(slot.atMs, hi)}
            </Body>
          </Row>
        ))}
        <Body muted style={{ marginTop: 10, fontSize: 12, lineHeight: 18 }}>
          {hi
            ? `सूर्योदय ${formatTimeIst(sunriseMs, hi)} · सूर्यास्त ${formatTimeIst(sunsetMs, hi)}`
            : `Sunrise ${formatTimeIst(sunriseMs, hi)} · Sunset ${formatTimeIst(sunsetMs, hi)}`}
        </Body>
      </Card>
    </View>
  );
}
