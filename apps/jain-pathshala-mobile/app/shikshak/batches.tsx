import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useAdminBatches, useMyStaffing } from "@/lib/queries";
import { formatTimeRange } from "@/lib/format";
import { formatAgeGroups } from "@workspace/api-zod";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const CENTRE_KEY = "jp.shikshak.selectedCentreId";

// ISO weekday: 1=Mon … 7=Sun (index 0 unused) — matches the API/web convention.
const DAYS_EN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_HI = ["", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"];

export default function BatchesScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminBatches();
  const staffing = useMyStaffing();
  const centres = staffing.data?.centres ?? [];
  const [selectedCentreId, setSelectedCentreId] = useState<string | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(CENTRE_KEY).then((stored) => {
      if (stored) setSelectedCentreId(stored);
    });
  }, []);

  useEffect(() => {
    if (centres.length === 0) return;
    const stillValid = selectedCentreId && centres.some((x) => x.centre_id === selectedCentreId);
    if (!stillValid) {
      const next = centres[0]!.centre_id;
      setSelectedCentreId(next);
      void AsyncStorage.setItem(CENTRE_KEY, next);
    }
  }, [centres, selectedCentreId]);

  function pickCentre(id: string) {
    setSelectedCentreId(id);
    void AsyncStorage.setItem(CENTRE_KEY, id);
  }

  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (!selectedCentreId || centres.length <= 1) return all;
    return all.filter((b) => b.centre_id === selectedCentreId);
  }, [data?.items, selectedCentreId, centres.length]);

  const days = (input: number[]) =>
    input
      .map((d) => (hi ? DAYS_HI[d] : DAYS_EN[d]))
      .filter(Boolean)
      .join(", ");

  const showSwitcher = centres.length > 1;

  return (
    <ActivityThemed accent="batches">
      <AppHeader title={hi ? "मेरे बैच" : "My batches"} />
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        {showSwitcher ? (
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
                const active = centre.centre_id === selectedCentreId;
                return (
                  <Pressable
                    key={centre.centre_id}
                    onPress={() => pickCentre(centre.centre_id)}
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
                      {centre.centre_name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {isLoading || staffing.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "बैच लोड नहीं हुए।" : "Could not load batches."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "कोई बैच नहीं मिला।" : "No batches found."} />
        ) : (
          items.map((b) => (
            <Card key={b.id}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Title style={{ fontSize: 17 }}>{b.name ?? (hi ? "बैच" : "Batch")}</Title>
                  <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                    {[b.centre_name, formatAgeGroups(b.age_groups, hi ? "hi" : "en")].filter(Boolean).join(" · ") || "—"}
                  </Body>
                </View>
                <Pill tone={b.status === "active" ? "success" : "neutral"} label={b.status} />
              </Row>
              {b.shikshak_name ? (
                <Body muted style={{ fontSize: 13, marginTop: 8 }}>
                  {hi ? "प्राथमिक" : "Primary"}: {b.shikshak_name}
                </Body>
              ) : null}
              <Body muted style={{ fontSize: 13, marginTop: 6 }}>
                {[days(b.day_of_week), formatTimeRange(b.start_time, b.end_time)]
                  .filter(Boolean)
                  .join(" · ")}
              </Body>
            </Card>
          ))
        )}
      </Screen>
    </ActivityThemed>
  );
}
