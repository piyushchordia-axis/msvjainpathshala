import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { cityDisplayName, type PanchangCity } from "@/lib/panchang/cities";
import type { PanchangCityOrigin } from "@/lib/panchang/city-prefs";
import { derivePachchakkhan } from "@/lib/panchang/pachchakkhan";
import { formatTimeIst } from "@/lib/panchang/solar";
import type { SunriseSunsetSource } from "@/lib/panchang/sun-override";
import { Body, Button, Card, Row, Title } from "@/components/ui";

export function PanchangPachchakkhanCard({
  city,
  origin,
  sunriseMs,
  sunsetMs,
  source,
  onChangeCity,
  onUseMyLocation,
  onDismissLocationOffer,
  locating = false,
}: {
  city: PanchangCity;
  /** Whether this city was chosen, measured, or is only a default. */
  origin: PanchangCityOrigin;
  sunriseMs: number;
  sunsetMs: number;
  source: SunriseSunsetSource;
  onChangeCity: () => void;
  onUseMyLocation: () => void;
  onDismissLocationOffer: () => void;
  locating?: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const slots = derivePachchakkhan(sunriseMs, sunsetMs);
  const cityName = cityDisplayName(city, hi);
  const unsettled = origin === "fallback";

  /*
   * The city belongs in BOTH captions. Override mode used to read a bare
   * "Official timings", dropping the name exactly when a named sangh's numbers
   * are in force — which is the moment a reader most needs to know whose
   * authority they are following.
   */
  const caption =
    source === "override"
      ? hi
        ? `आधिकारिक समय · ${cityName}`
        : `Official timings · ${cityName}`
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
          accessibilityLabel={
            hi ? `शहर बदलें — अभी ${cityName}` : `Change city — currently ${cityName}`
          }
          style={{ minHeight: 44, justifyContent: "center" }}
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

      {/*
        The times are only as right as the city. When nobody has told us and we
        have not measured, say so HERE — beside the numbers — and offer the fix.
        Location is requested from this tap, never from opening the screen: a
        permission dialog nobody can attribute to an action gets denied, and the
        denial used to be permanent.
      */}
      {unsettled ? (
        <Card style={{ marginBottom: 10, backgroundColor: c.accent }}>
          <Row style={{ gap: 10, alignItems: "flex-start" }}>
            <Ionicons name="information-circle-outline" size={20} color={c.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Body style={{ fontSize: 14, lineHeight: 22 }}>
                {hi
                  ? `ये समय ${cityName} के लिए गणना किए गए हैं। दूसरे शहर में समय कुछ मिनट अलग होता है।`
                  : `These times are calculated for ${cityName}. In another city they differ by several minutes.`}
              </Body>
              <Row style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Button
                  label={hi ? "मेरा स्थान उपयोग करें" : "Use my location"}
                  icon="navigate-outline"
                  compact
                  loading={locating}
                  onPress={onUseMyLocation}
                />
                <Button
                  label={hi ? "शहर चुनें" : "Choose city"}
                  variant="outline"
                  compact
                  onPress={onChangeCity}
                />
                <Button
                  label={hi ? `${cityName} ठीक है` : `${cityName} is right`}
                  variant="outline"
                  compact
                  onPress={onDismissLocationOffer}
                />
              </Row>
            </View>
          </Row>
        </Card>
      ) : null}

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
            <Title style={{ fontSize: 15, lineHeight: 22 }}>
              {hi ? slot.label_hi : slot.label}
            </Title>
            <Body style={{ fontSize: 15, lineHeight: 22 }}>
              {formatTimeIst(slot.atMs, hi, slot.boundary === "start" ? "up" : "down")}
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
