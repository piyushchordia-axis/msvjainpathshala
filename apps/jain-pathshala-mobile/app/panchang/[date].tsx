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
import { DEFAULT_PANCHANG_CITY_KEY, getPanchangCity } from "@/lib/panchang/cities";
import {
  dismissPanchangCityPrompt,
  locatePanchangCity,
  resolvePanchangCity,
  writePanchangCityKey,
  type ResolvedPanchangCity,
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
import { PanchangUnpublishedNotice } from "@/components/PanchangUnpublishedNotice";
import { Body, Card, Row, Screen, StateView, Title } from "@/components/ui";

/** YYYY-MM-DD, as the route parameter must be. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day `delta` days from `iso`, in Asia/Kolkata terms.
 *
 * Built on UTC noon so a DST-free but offset timezone cannot round a date
 * backwards — the app is IST-only, but the arithmetic should not depend on
 * that.
 */
function shiftIsoDate(iso: string, delta: number): string {
  const base = new Date(`${iso}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

/**
 * Move to the previous / next day.
 *
 * "What time is Navkarsi tomorrow?" is the evening question this screen exists
 * to answer, and answering it meant going back, finding tomorrow's cell in the
 * grid, and tapping it. `router.replace` rather than push so walking a week
 * forward does not build a seven-deep back stack.
 */
function DayStepper({
  date,
  hi,
  color,
}: {
  date: string;
  hi: boolean;
  color: string;
}) {
  const step = (delta: number) => {
    const next = shiftIsoDate(date, delta);
    router.replace(`/panchang/${next}` as Href);
  };
  const spoken = (delta: number) =>
    new Date(`${shiftIsoDate(date, delta)}T12:00:00`).toLocaleDateString(
      hi ? "hi-IN" : "en-IN",
      { day: "numeric", month: "long" },
    );
  return (
    <Row style={{ justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
      <Pressable
        onPress={() => step(-1)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${hi ? "पिछला दिन" : "Previous day"} — ${spoken(-1)}`}
        style={{ minHeight: 44, justifyContent: "center", paddingRight: 12 }}
      >
        <Row style={{ alignItems: "center", gap: 4 }}>
          <Ionicons name="chevron-back" size={18} color={color} />
          <Body style={{ fontSize: 14, lineHeight: 22, color }}>
            {hi ? "पिछला दिन" : "Previous day"}
          </Body>
        </Row>
      </Pressable>
      <Pressable
        onPress={() => step(1)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${hi ? "अगला दिन" : "Next day"} — ${spoken(1)}`}
        style={{ minHeight: 44, justifyContent: "center", paddingLeft: 12 }}
      >
        <Row style={{ alignItems: "center", gap: 4 }}>
          <Body style={{ fontSize: 14, lineHeight: 22, color }}>
            {hi ? "अगला दिन" : "Next day"}
          </Body>
          <Ionicons name="chevron-forward" size={18} color={color} />
        </Row>
      </Pressable>
    </Row>
  );
}

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
  const [resolvedCity, setResolvedCity] = useState<ResolvedPanchangCity>(() => ({
    city: getPanchangCity(DEFAULT_PANCHANG_CITY_KEY),
    origin: "fallback",
  }));
  const [locating, setLocating] = useState(false);
  const city = resolvedCity.city;
  const [override, setOverride] = useState<SunOverrideFile | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const year = date ? yearFromIsoDate(date) : 0;

  useEffect(() => {
    if (!date || !ISO_DATE.test(date)) {
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

  /*
   * City bootstrap. Reads the stored preference only — it never asks for
   * location and never writes one. A permission dialog fired by opening a
   * calendar day is unattributable, and the denial used to be persisted as if
   * the reader had picked Ahmedabad. The offer to locate lives in the
   * Pachchakkhan card, next to the times it affects.
   */
  useEffect(() => {
    let cancelled = false;
    void resolvePanchangCity().then((resolved) => {
      if (!cancelled) setResolvedCity(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function useMyLocation() {
    setLocating(true);
    try {
      setResolvedCity(await locatePanchangCity());
    } finally {
      setLocating(false);
    }
  }

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

  // A malformed date in the URL is the one case with nothing to show at all.
  if (!date || !ISO_DATE.test(date)) {
    return (
      <Screen>
        <StateView
          status="empty"
          emptyText={hi ? "यह दिन मान्य नहीं है।" : "That is not a valid date."}
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
      {day ? (
        <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 20 }}>
          {vaarLabel(day.vaar, hi)}
        </Body>
      ) : null}

      {/* No verified year: say so, then carry on to the sun times, which are
          computed for the reader's city and are unaffected by any of this. */}
      {!day || !yearData ? (
        <View style={{ marginTop: 16 }}>
          <PanchangUnpublishedNotice year={year} />
        </View>
      ) : null}

      {day && yearData ? (
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
      ) : null}

      {sun ? (
        <PanchangPachchakkhanCard
          city={city}
          origin={resolvedCity.origin}
          sunriseMs={sun.sunriseMs}
          sunsetMs={sun.sunsetMs}
          source={sun.source}
          locating={locating}
          onChangeCity={() => setPickerOpen(true)}
          onUseMyLocation={() => void useMyLocation()}
          onDismissLocationOffer={() => {
            setResolvedCity({ city, origin: "chosen" });
            void dismissPanchangCityPrompt(city.key);
          }}
        />
      ) : null}

      {/* Events come from the transcription too, so they are absent for the
          same reason and must not be shown as "none listed" — that would read
          as "nothing happens today", which is a different claim. */}
      {day ? (
        <>
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
        </>
      ) : null}

      <DayStepper date={date} hi={hi} color={c.primary} />

      <PanchangCityPicker
        visible={pickerOpen}
        selectedKey={city.key}
        onClose={() => setPickerOpen(false)}
        onSelect={(next) => {
          setResolvedCity({ city: next, origin: "chosen" });
          void writePanchangCityKey(next.key);
        }}
      />
    </Screen>
  );
}
