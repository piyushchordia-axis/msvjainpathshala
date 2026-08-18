import { useEffect, useMemo, useState } from "react";
import { Pressable } from "react-native";
import { router, type Href } from "expo-router";
import { useLocale } from "@/contexts/LocaleContext";
import { useColors } from "@/hooks/useColors";
import {
  buildPanchangMonthCells,
  formatJainDateLine,
  indexDaysByDate,
  pakshaLabel,
  vaarLabel,
} from "@/lib/panchang/calendar";
import {
  loadPanchangYear,
  todayIstDate,
  yearFromIsoDate,
} from "@/lib/panchang/load";
import type { PanchangYear } from "@/lib/panchang/schema";
import { PanchangMonthCalendar } from "@/components/PanchangMonthCalendar";
import { PanchangUnpublishedNotice } from "@/components/PanchangUnpublishedNotice";
import { Body, Card, Screen, StateView, Title } from "@/components/ui";

/**
 * Panchang month calendar — defaults to today (Asia/Kolkata).
 *
 * Offline-first: AsyncStorage cache, then whatever the API has published. There
 * is no bundled year any more (see lib/panchang/load.ts), so "no data" is an
 * ordinary state rather than an error, and the grid still renders — a reader can
 * open a day and get their Pachchakkhan times whether or not the tithis exist.
 */
export default function PanchangScreen() {
  const { hi } = useLocale();
  const c = useColors();
  const today = todayIstDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [yearData, setYearData] = useState<PanchangYear | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const year = yearFromIsoDate(`${month}-01`);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    void loadPanchangYear(year)
      .then((data) => {
        if (cancelled) return;
        setYearData(data);
        // An absent year is not an error. It means nobody has transcribed and
        // verified this one yet, which the notice explains in those terms.
        setError(false);
      })
      .catch(() => {
        if (!cancelled) {
          setYearData(null);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const dayByDate = useMemo(
    () => (yearData ? indexDaysByDate(yearData) : new Map()),
    [yearData],
  );

  const cells = useMemo(
    () =>
      buildPanchangMonthCells({
        month,
        dayByDate,
        todayIso: today,
      }),
    [month, dayByDate, today],
  );

  const todayDay = dayByDate.get(today) ?? null;
  // Clamped to the year only when there IS one; with no data every month is
  // equally (un)available and clamping would just trap the reader in January.
  const minMonth = yearData ? `${year}-01` : undefined;
  const maxMonth = yearData ? `${year}-12` : undefined;

  return (
    <Screen contentStyle={{ paddingBottom: 40 }}>
      <Title style={{ fontSize: 22, lineHeight: 30, marginBottom: 4 }}>
        {hi ? "पंचांग" : "Panchang"}
      </Title>
      {yearData ? (
        <Body muted style={{ marginBottom: 12, fontSize: 13, lineHeight: 20 }}>
          {hi
            ? `विक्रम संवत ${yearData.vikramSamvat} · वीर संवत ${yearData.veerSamvat}`
            : `Vikram Samvat ${yearData.vikramSamvat} · Veer Samvat ${yearData.veerSamvat}`}
        </Body>
      ) : null}

      {loading ? (
        <StateView status="loading" emptyText="" />
      ) : error ? (
        <StateView
          status="error"
          emptyText=""
          errorText={
            hi
              ? "पंचांग लोड नहीं हो सका। दोबारा कोशिश करें।"
              : "The Panchang could not be loaded — try again."
          }
        />
      ) : (
        <>
          {!yearData ? <PanchangUnpublishedNotice year={year} /> : null}
          <PanchangMonthCalendar
            month={month}
            onMonthChange={setMonth}
            cells={cells}
            months={yearData?.months ?? []}
            minMonth={minMonth}
            maxMonth={maxMonth}
            onDayPress={(date) => router.push(`/panchang/${date}` as Href)}
          />

          {yearData && todayDay && month === today.slice(0, 7) ? (
            <Pressable
              onPress={() => router.push(`/panchang/${today}` as Href)}
              accessibilityRole="button"
              style={{ marginTop: 14 }}
            >
              <Card style={{ backgroundColor: c.accent }}>
                <Body muted style={{ fontSize: 12, lineHeight: 18 }}>
                  {hi ? "आज" : "Today"}
                </Body>
                <Title style={{ fontSize: 16, lineHeight: 22, marginTop: 4 }}>
                  {formatJainDateLine(todayDay, yearData.months, hi)}
                </Title>
                <Body style={{ marginTop: 4, fontSize: 14, lineHeight: 22 }}>
                  {vaarLabel(todayDay.vaar, hi)}
                  {" · "}
                  {pakshaLabel(todayDay.paksha, hi)} {todayDay.tithi}
                </Body>
              </Card>
            </Pressable>
          ) : null}
        </>
      )}
    </Screen>
  );
}
