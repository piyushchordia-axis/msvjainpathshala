import { useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { bodyFamily } from "@/constants/typography";
import { currentMonthIst } from "@/lib/attendance-calendar";
import { ApiError } from "@/lib/api";
import {
  useAdminCentres,
  useCentreHolidays,
  useCreateCentreHoliday,
  useDeleteCentreHoliday,
  usePatchCentreHoliday,
  type CentreHolidayRow,
} from "@/lib/queries";
import {
  expandInclusiveDateRange,
  HolidayMonthCalendar,
} from "@/components/HolidayMonthCalendar";
import { AppHeader } from "@/components/AppHeader";
import { CentreSwitcher, usePersistedCentreId } from "@/components/CentreSwitcher";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const CENTRE_KEY = "jp.sanchalak.selectedCentreId";
const MAX_RANGE_DAYS = 31;

const AT10_EN =
  "Classes scheduled at this centre on those dates will be cancelled. Sessions that already have attendance are kept.";
const AT10_HI =
  "इन तिथियों को इस केंद्र पर निर्धारित कक्षाएँ रद्द हो जाएँगी। जिन सत्रों में पहले से उपस्थिति दर्ज है, वे रहेंगे।";

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthLabel(ym: string, hi: boolean): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, (m ?? 1) - 1, 1);
  return d.toLocaleDateString(hi ? "hi-IN" : "en-IN", { month: "long", year: "numeric" });
}

export default function HolidaysScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const centresQ = useAdminCentres();
  const centres = useMemo(
    () =>
      (centresQ.data?.items ?? []).map((x) => ({
        centre_id: x.id,
        centre_name: x.name,
      })),
    [centresQ.data?.items],
  );
  const [selectedCentreId, pickCentre] = usePersistedCentreId(centres, CENTRE_KEY);
  const holidaysQ = useCentreHolidays(selectedCentreId);
  const createMut = useCreateCentreHoliday();
  const patchMut = usePatchCentreHoliday();
  const deleteMut = useDeleteCentreHoliday();

  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [picking, setPicking] = useState<"start" | "end">("start");
  const [reason, setReason] = useState("");
  const [month, setMonth] = useState(currentMonthIst);
  const [saving, setSaving] = useState(false);

  const holidayDates = useMemo(() => {
    const set = new Set<string>();
    for (const h of holidaysQ.data?.items ?? []) set.add(h.holiday_date);
    return set;
  }, [holidaysQ.data?.items]);

  const grouped = useMemo(() => {
    const items = holidaysQ.data?.items ?? [];
    const map = new Map<string, CentreHolidayRow[]>();
    for (const h of items) {
      const key = monthKey(h.holiday_date);
      const list = map.get(key) ?? [];
      list.push(h);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [holidaysQ.data?.items]);

  function onDayPress(date: string) {
    if (picking === "start" || !startDate) {
      setStartDate(date);
      setEndDate(null);
      setPicking("end");
      setMonth(date.slice(0, 7));
      return;
    }
    // Second tap completes the range (swap if before start).
    if (date < startDate) {
      setEndDate(startDate);
      setStartDate(date);
    } else {
      setEndDate(date);
    }
    setPicking("start");
  }

  async function addRange() {
    if (!selectedCentreId || !startDate) return;
    const end = endDate ?? startDate;
    const dates = expandInclusiveDateRange(startDate, end);
    if (dates.length > MAX_RANGE_DAYS) {
      Alert.alert(
        hi ? "सीमा बहुत लंबी" : "Range too long",
        hi
          ? `एक बार में अधिकतम ${MAX_RANGE_DAYS} दिन जोड़ें।`
          : `Add at most ${MAX_RANGE_DAYS} days at a time.`,
      );
      return;
    }
    Alert.alert(
      hi ? "अवकाश जोड़ें?" : "Add holiday?",
      `${hi ? AT10_HI : AT10_EN}\n\n${startDate}${end !== startDate ? ` → ${end}` : ""} (${dates.length} ${hi ? "दिन" : "day(s)"})`,
      [
        { text: hi ? "रद्द" : "Cancel", style: "cancel" },
        {
          text: hi ? "जोड़ें" : "Add",
          onPress: () => {
            void (async () => {
              setSaving(true);
              let okCount = 0;
              let failCount = 0;
              for (const holiday_date of dates) {
                try {
                  await createMut.mutateAsync({
                    centreId: selectedCentreId,
                    holiday_date,
                    reason: reason.trim() || undefined,
                  });
                  okCount += 1;
                } catch {
                  failCount += 1;
                }
              }
              setSaving(false);
              setStartDate(null);
              setEndDate(null);
              setReason("");
              setPicking("start");
              if (failCount === 0) {
                Alert.alert(
                  hi ? "हो गया" : "Done",
                  hi ? `${okCount} अवकाश दिन जोड़े गए।` : `Added ${okCount} holiday day(s).`,
                );
              } else {
                Alert.alert(
                  hi ? "आंशिक सफलता" : "Partial success",
                  hi
                    ? `${okCount} जोड़े, ${failCount} विफल (शायद पहले से मौजूद)।`
                    : `${okCount} added, ${failCount} failed (may already exist).`,
                );
              }
            })();
          },
        },
      ],
    );
  }

  const rangeLabel =
    startDate && endDate
      ? `${startDate} → ${endDate}`
      : startDate
        ? `${startDate}${hi ? " (समाप्ति चुनें)" : " (pick end)"}`
        : hi
          ? "कैलेंडर पर आरंभ तिथि चुनें"
          : "Tap a start date on the calendar";

  return (
    <ActivityThemed accent="holidays">
      <AppHeader
        title={hi ? "अवकाश" : "Holidays"}
        subtitle={hi ? "केंद्र के अवकाश दिन" : "Centre holiday calendar"}
        showBack
        backHref="/admin/dashboard"
      />
      <Screen
        refreshing={centresQ.isRefetching || holidaysQ.isRefetching}
        onRefresh={() => {
          void centresQ.refetch();
          void holidaysQ.refetch();
        }}
      >
        <CentreSwitcher
          centres={centres}
          storageKey={CENTRE_KEY}
          selectedId={selectedCentreId}
          onChange={pickCentre}
        />

        {selectedCentreId ? (
          <Card>
            <Title style={{ fontSize: 16, marginBottom: 10, lineHeight: 24 }}>
              {hi ? "अवकाश जोड़ें" : "Add holiday"}
            </Title>

            <Row style={{ gap: 10, marginBottom: 12 }}>
              <Pressable
                onPress={() => setPicking("start")}
                style={{
                  flex: 1,
                  backgroundColor: picking === "start" ? c.accent : c.muted,
                  borderRadius: c.radius ?? 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: picking === "start" ? c.primary : c.border,
                }}
              >
                <Text
                  style={{
                    fontFamily: bodyFamily(hi),
                    fontSize: 12,
                    color: c.mutedForeground,
                    lineHeight: 18,
                    marginBottom: 2,
                  }}
                >
                  {hi ? "आरंभ तिथि" : "Start date"}
                </Text>
                <Text
                  style={{
                    fontFamily: bodyFamily(hi, "semibold"),
                    fontSize: 15,
                    color: c.foreground,
                    lineHeight: 22,
                  }}
                >
                  {startDate ?? "—"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (startDate) setPicking("end");
                }}
                style={{
                  flex: 1,
                  backgroundColor: picking === "end" ? c.accent : c.muted,
                  borderRadius: c.radius ?? 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: picking === "end" ? c.primary : c.border,
                  opacity: startDate ? 1 : 0.55,
                }}
              >
                <Text
                  style={{
                    fontFamily: bodyFamily(hi),
                    fontSize: 12,
                    color: c.mutedForeground,
                    lineHeight: 18,
                    marginBottom: 2,
                  }}
                >
                  {hi ? "समाप्ति तिथि" : "End date"}
                </Text>
                <Text
                  style={{
                    fontFamily: bodyFamily(hi, "semibold"),
                    fontSize: 15,
                    color: c.foreground,
                    lineHeight: 22,
                  }}
                >
                  {endDate ?? (startDate ? startDate : "—")}
                </Text>
              </Pressable>
            </Row>

            <Body muted style={{ fontSize: 13, marginBottom: 12, lineHeight: 22 }}>
              {rangeLabel}
            </Body>

            <Body muted style={{ fontSize: 12, marginBottom: 4, lineHeight: 22 }}>
              {hi ? "कारण" : "Reason"}
            </Body>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder={hi ? "उदा. दीपावली" : "e.g. Diwali"}
              placeholderTextColor={c.mutedForeground}
              style={{
                fontFamily: bodyFamily(hi),
                fontSize: 16,
                lineHeight: 22,
                color: c.foreground,
                backgroundColor: c.muted,
                borderRadius: c.radius ?? 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                marginBottom: 12,
              }}
            />
            <Button
              label={hi ? "जोड़ें" : "Add holiday"}
              onPress={() => void addRange()}
              loading={saving || createMut.isPending}
              disabled={!startDate}
            />
          </Card>
        ) : null}

        {selectedCentreId ? (
          <HolidayMonthCalendar
            month={month}
            onMonthChange={setMonth}
            holidayDates={holidayDates}
            rangeStart={startDate}
            rangeEnd={endDate ?? (picking === "end" ? startDate : null)}
            onDayPress={onDayPress}
          />
        ) : null}

        {centresQ.isLoading || holidaysQ.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : centresQ.isError || holidaysQ.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "अवकाश लोड नहीं हुए।" : "Could not load holidays."}
            onRetry={() => {
              void centresQ.refetch();
              void holidaysQ.refetch();
            }}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : !selectedCentreId ? (
          <StateView
            status="empty"
            emptyText={hi ? "कोई केंद्र नहीं मिला।" : "No centres found."}
          />
        ) : grouped.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "कोई अवकाश नहीं।" : "No holidays yet."}
          />
        ) : (
          grouped.map(([ym, rows]) => (
            <View key={ym} style={{ marginTop: 8 }}>
              <Title style={{ fontSize: 15, marginBottom: 8, lineHeight: 22 }}>
                {monthLabel(ym, hi)}
              </Title>
              {rows.map((h) => (
                <Card key={h.id}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Title style={{ fontSize: 16, lineHeight: 24 }}>{h.holiday_date}</Title>
                      <Body muted style={{ marginTop: 4, lineHeight: 22 }}>
                        {h.reason?.trim() || (hi ? "कोई कारण नहीं" : "No reason")}
                      </Body>
                    </View>
                    <Pill
                      tone={h.is_published ? "success" : "neutral"}
                      label={h.is_published ? (hi ? "प्रकाशित" : "Published") : hi ? "ड्राफ्ट" : "Draft"}
                    />
                  </Row>
                  <Row style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                    <Button
                      label={
                        h.is_published
                          ? hi
                            ? "अप्रकाशित करें"
                            : "Unpublish"
                          : hi
                            ? "प्रकाशित करें"
                            : "Publish"
                      }
                      variant="outline"
                      loading={
                        patchMut.isPending && patchMut.variables?.holidayId === h.id
                      }
                      onPress={() => {
                        if (!selectedCentreId) return;
                        patchMut.mutate(
                          {
                            centreId: selectedCentreId,
                            holidayId: h.id,
                            is_published: !h.is_published,
                          },
                          {
                            onError: (e) =>
                              Alert.alert(
                                hi ? "त्रुटि" : "Error",
                                e instanceof ApiError
                                  ? e.message
                                  : e instanceof Error
                                    ? e.message
                                    : "Action failed",
                              ),
                          },
                        );
                      }}
                    />
                    <Button
                      label={hi ? "हटाएँ" : "Delete"}
                      variant="ghost"
                      loading={
                        deleteMut.isPending && deleteMut.variables?.holidayId === h.id
                      }
                      onPress={() => {
                        if (!selectedCentreId) return;
                        const n = h.restorable_session_count ?? 0;
                        Alert.alert(
                          hi ? "अवकाश हटाएँ?" : "Delete holiday?",
                          hi
                            ? n > 0
                              ? `यह अवकाश हटाया जाएगा और लगभग ${n} रद्द सत्र बहाल हो सकते हैं।`
                              : "यह अवकाश हटा दिया जाएगा।"
                            : n > 0
                              ? `This holiday will be removed and about ${n} cancelled sessions may be restored.`
                              : "This holiday will be removed.",
                          [
                            { text: hi ? "रद्द" : "Cancel", style: "cancel" },
                            {
                              text: hi ? "हटाएँ" : "Delete",
                              style: "destructive",
                              onPress: () =>
                                deleteMut.mutate(
                                  { centreId: selectedCentreId, holidayId: h.id },
                                  {
                                    onError: (e) =>
                                      Alert.alert(
                                        hi ? "त्रुटि" : "Error",
                                        e instanceof ApiError
                                          ? e.message
                                          : e instanceof Error
                                            ? e.message
                                            : "Action failed",
                                      ),
                                  },
                                ),
                            },
                          ],
                        );
                      }}
                    />
                  </Row>
                </Card>
              ))}
            </View>
          ))
        )}
      </Screen>
    </ActivityThemed>
  );
}
