import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useLocale } from "@/contexts/LocaleContext";
import { useColors } from "@/hooks/useColors";
import {
  formatJainDateLine,
  indexDaysByDate,
  monthName,
  pakshaLabel,
  vaarLabel,
} from "@/lib/panchang/calendar";
import {
  DEFAULT_PANCHANG_CITY_KEY,
  getPanchangCity,
  type PanchangCity,
} from "@/lib/panchang/cities";
import {
  resolvePanchangCity,
  writePanchangCityKey,
} from "@/lib/panchang/city-prefs";
import {
  loadPanchangYear,
  yearFromIsoDate,
} from "@/lib/panchang/load";
import type { PanchangEvent, PanchangYear } from "@/lib/panchang/schema";
import {
  loadSunOverride,
  resolveSunriseSunset,
} from "@/lib/panchang/sun-override";
import type { SunOverrideFile } from "@/lib/panchang/sun-override-schema";
import { PanchangCityPicker } from "@/components/PanchangCityPicker";
import { PanchangPachchakkhanCard } from "@/components/PanchangPachchakkhanCard";
import { Body, Card, Row, Screen, StateView, Title } from "@/components/ui";

function EventRow({
  event,
  hi,
}: {
  event: PanchangEvent;
  hi: boolean;
}) {
  const c = useColors();
  const title = hi
    ? event.title_hi || event.title_en
    : event.title_en || event.title_hi;
  const note = hi
    ? event.note_hi || event.note_en
    : event.note_en || event.note_hi;
  const linked = !!event.linkedItemId;

  const inner = (
    <Card
      style={{
        backgroundColor: event.highlight ? c.accent : c.card,
        borderWidth: event.highlight ? 1 : 0,
        borderColor: c.primary,
      }}
    >
      <Row style={{ gap: 10, alignItems: "flex-start" }}>
        <Ionicons
          name={event.highlight ? "star" : "calendar-outline"}
          size={18}
          color={c.primary}
          style={{ marginTop: 2 }}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Title style={{ fontSize: 15, lineHeight: 22 }}>{title}</Title>
          {note ? (
            <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 20 }}>
              {note}
            </Body>
          ) : null}
          {linked ? (
            <Body style={{ marginTop: 6, fontSize: 13, lineHeight: 20, color: c.primary }}>
              {hi ? "पुस्तकालय में देखें" : "Open in library"}
            </Body>
          ) : null}
        </View>
        {linked ? (
          <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
        ) : null}
      </Row>
    </Card>
  );

  if (!linked) return inner;

  return (
    <Pressable
      onPress={() =>
        router.push(`/library/item/${event.linkedItemId}` as Href)
      }
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {inner}
    </Pressable>
  );
}

export default function PanchangDayScreen() {
  const { date: raw } = useLocalSearchParams<{ date: string }>();
  const date = String(raw ?? "");
  const { hi } = useLocale();
  const c = useColors();
  const [yearData, setYearData] = useState<PanchangYear | null>(null);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState<PanchangCity>(() =>
    getPanchangCity(DEFAULT_PANCHANG_CITY_KEY),
  );
  const [override, setOverride] = useState<SunOverrideFile | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const year = date ? yearFromIsoDate(date) : 0;

  useEffect(() => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadPanchangYear(year)
      .then((data) => {
        if (!cancelled) setYearData(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, year]);

  // City bootstrap: AMD immediately, then pref / GPS when ready.
  useEffect(() => {
    let cancelled = false;
    void resolvePanchangCity().then((resolved) => {
      if (!cancelled) setCity(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSunOverride(city.key, year).then((file) => {
      if (!cancelled) setOverride(file);
    });
    return () => {
      cancelled = true;
    };
  }, [city.key, year]);

  const day = useMemo(() => {
    if (!yearData) return null;
    return indexDaysByDate(yearData).get(date) ?? null;
  }, [yearData, date]);

  const sun = useMemo(() => {
    if (!date) return null;
    return resolveSunriseSunset({ city, date, override });
  }, [city, date, override]);

  if (loading) {
    return (
      <Screen>
          <StateView status="loading" emptyText="" />
        </Screen>
    );
  }

  if (!day || !yearData) {
    return (
      <Screen>
          <StateView
            status="empty"
            emptyText={
              hi ? "इस दिन का पंचांग नहीं मिला।" : "No Panchang entry for this day."
            }
          />
        </Screen>
    );
  }

  const gregLabel = new Date(`${date}T12:00:00`).toLocaleDateString(
    hi ? "hi-IN" : "en-IN",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );

  return (
    <Screen contentStyle={{ paddingBottom: 40 }}>
      <Title style={{ fontSize: 22, lineHeight: 30 }}>{gregLabel}</Title>
      <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 20 }}>
        {vaarLabel(day.vaar, hi)}
      </Body>

      <Card style={{ marginTop: 16 }}>
        <Body muted style={{ fontSize: 12, lineHeight: 18 }}>
          {hi ? "जैन तिथि" : "Jain tithi"}
        </Body>
        <Title style={{ fontSize: 18, lineHeight: 26, marginTop: 4 }}>
          {formatJainDateLine(day, yearData.months, hi)}
        </Title>
        <Body style={{ marginTop: 8, fontSize: 14, lineHeight: 22 }}>
          {monthName(yearData.months, day.month, hi)}
          {" · "}
          {pakshaLabel(day.paksha, hi)}
          {" · "}
          {hi ? "तिथि" : "Tithi"} {day.tithi}
          {day.tithiStatus === "vridhi"
            ? hi
              ? " (वृद्धि)"
              : " (Vridhi)"
            : ""}
        </Body>
        <Body muted style={{ marginTop: 6, fontSize: 13, lineHeight: 20 }}>
          {hi ? "नक्षत्र" : "Nakshatra"}: {day.nakshatra}
        </Body>
        {day.parvTithi ? (
          <Body style={{ marginTop: 8, fontSize: 13, lineHeight: 20, color: c.secondary }}>
            {hi ? "पर्व तिथि" : "Parv tithi"}
          </Body>
        ) : null}
      </Card>

      {sun ? (
        <PanchangPachchakkhanCard
          city={city}
          sunriseMs={sun.sunriseMs}
          sunsetMs={sun.sunsetMs}
          source={sun.source}
          onChangeCity={() => setPickerOpen(true)}
        />
      ) : null}

      <Title style={{ fontSize: 16, lineHeight: 22, marginTop: 20, marginBottom: 8 }}>
        {hi ? "घटनाएँ" : "Events"}
      </Title>
      {day.events.length === 0 ? (
        <Body muted style={{ lineHeight: 22 }}>
          {hi ? "इस दिन कोई घटना सूचीबद्ध नहीं है।" : "No events listed for this day."}
        </Body>
      ) : (
        <View style={{ gap: 10 }}>
          {day.events.map((ev) => (
            <EventRow key={ev.id} event={ev} hi={hi} />
          ))}
        </View>
      )}

      <PanchangCityPicker
        visible={pickerOpen}
        selectedKey={city.key}
        onClose={() => setPickerOpen(false)}
        onSelect={(next) => {
          setCity(next);
          void writePanchangCityKey(next.key);
        }}
      />
    </Screen>
  );
}
