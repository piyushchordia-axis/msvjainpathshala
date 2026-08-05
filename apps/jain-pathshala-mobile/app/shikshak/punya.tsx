/**
 * Guruji batch Punya standings — pastoral view of how your students are doing.
 * Not a public scoreboard; ranks stay on this screen only.
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminBatches, useBatchPunyaStandings } from "@/lib/queries";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Row, Screen, StateView, Title } from "@/components/ui";

const BATCH_KEY = "jp.shikshak.selectedBatchId";

const TIER_ORDER = ["jigyasu", "shravak", "sadhak", "shraman", "tirthankar"] as const;

const SOURCE_LABELS: Record<string, { en: string; hi: string }> = {
  attendance: { en: "Attendance", hi: "उपस्थिति" },
  attendance_streak: { en: "Attendance streak", hi: "उपस्थिति श्रृंखला" },
  niyam: { en: "Niyam", hi: "नियम" },
  homework: { en: "Homework", hi: "गृहकार्य" },
  quiz: { en: "Quiz", hi: "प्रश्नोत्तरी" },
  manual_award: { en: "Manual", hi: "हाथ से" },
};

function currentMonthLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string, hi: boolean): string {
  const [yStr, mStr] = month.split("-");
  const d = new Date(Number(yStr), Number(mStr) - 1, 1);
  return d.toLocaleDateString(hi ? "hi-IN" : "en-IN", { month: "long", year: "numeric" });
}

function tierColor(
  tier: string,
  c: ReturnType<typeof useColors>,
): string {
  switch (tier) {
    case "shravak":
      return c.tierShravak;
    case "sadhak":
      return c.tierSadhak;
    case "shraman":
      return c.tierShraman;
    case "tirthankar":
      return c.tierTirthankar;
    default:
      return c.tierJigyasu;
  }
}

function tierLabel(tier: string, hi: boolean): string {
  const map: Record<string, { en: string; hi: string }> = {
    jigyasu: { en: "Jigyasu", hi: "जिज्ञासु" },
    shravak: { en: "Shravak", hi: "श्रावक" },
    sadhak: { en: "Sadhak", hi: "साधक" },
    shraman: { en: "Shraman", hi: "श्रमण" },
    tirthankar: { en: "Tirthankar", hi: "तीर्थंकर" },
  };
  const row = map[tier] ?? map.jigyasu!;
  return hi ? row.hi : row.en;
}

function sourceLabel(key: string, hi: boolean): string {
  const known = SOURCE_LABELS[key];
  if (known) return hi ? known.hi : known.en;
  return key.replace(/_/g, " ");
}

function monthDeltaText(points: number, hi: boolean): string {
  if (points > 0) {
    return hi ? `+${points} इस माह` : `+${points} this month`;
  }
  if (points < 0) {
    return hi ? `${points} इस माह` : `${points} this month`;
  }
  return hi ? "इस माह 0" : "0 this month";
}

export default function ShikshakPunyaStandingsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const batchesQ = useAdminBatches();
  const batches = batchesQ.data?.items ?? [];

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonthLocal);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const maxMonth = currentMonthLocal();

  useEffect(() => {
    void AsyncStorage.getItem(BATCH_KEY).then((stored) => {
      if (stored) setSelectedBatchId(stored);
    });
  }, []);

  useEffect(() => {
    if (batches.length === 0) return;
    const stillValid = selectedBatchId && batches.some((b) => b.id === selectedBatchId);
    if (!stillValid) {
      const next = batches[0]!.id;
      setSelectedBatchId(next);
      void AsyncStorage.setItem(BATCH_KEY, next);
    }
  }, [batches, selectedBatchId]);

  function pickBatch(id: string) {
    setSelectedBatchId(id);
    void AsyncStorage.setItem(BATCH_KEY, id);
  }

  const standings = useBatchPunyaStandings(selectedBatchId, month, !!selectedBatchId);
  const items = standings.data?.items ?? [];
  const meta = standings.data?.meta;
  const showBatchSwitcher = batches.length > 1;

  const bySourceEntries = useMemo(() => {
    const src = meta?.by_source ?? {};
    return Object.entries(src)
      .map(([k, v]) => [k, Number(v)] as const)
      .filter(([, v]) => v !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  }, [meta?.by_source]);

  const canGoForward = month < maxMonth;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "पुण्य स्थिति" : "Punya standings"}
        subtitle={
          hi
            ? "आपके बैच के विद्यार्थियों की पुण्य प्रगति"
            : "How your batch is progressing in Punya"
        }
      />
      <Screen refreshing={standings.isRefetching} onRefresh={standings.refetch}>
        {showBatchSwitcher ? (
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
              {hi ? "बैच चुनें" : "Batch"}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 4 }}
            >
              {batches.map((batch) => {
                const active = batch.id === selectedBatchId;
                return (
                  <Pressable
                    key={batch.id}
                    onPress={() => pickBatch(batch.id)}
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
                      {batch.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <Row style={{ alignItems: "center", justifyContent: "center", marginBottom: 12, gap: 16 }}>
          <Pressable
            onPress={() => setMonth((m) => shiftMonth(m, -1))}
            hitSlop={12}
            accessibilityLabel={hi ? "पिछला माह" : "Previous month"}
          >
            <Ionicons name="chevron-back" size={22} color={c.foreground} />
          </Pressable>
          <Text
            style={{
              fontFamily: bodyFamily(hi, "semibold"),
              fontSize: 16,
              color: c.foreground,
              minWidth: 140,
              textAlign: "center",
            }}
          >
            {formatMonthLabel(month, hi)}
          </Text>
          <Pressable
            onPress={() => {
              if (canGoForward) setMonth((m) => shiftMonth(m, 1));
            }}
            hitSlop={12}
            disabled={!canGoForward}
            accessibilityLabel={hi ? "अगला माह" : "Next month"}
          >
            <Ionicons
              name="chevron-forward"
              size={22}
              color={canGoForward ? c.foreground : c.inkDim}
            />
          </Pressable>
        </Row>

        {batchesQ.isLoading || standings.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : standings.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={
              hi
                ? "पुण्य स्थिति लोड नहीं हुई — फिर से कोशिश करें।"
                : "Could not load Punya standings — try again."
            }
            onRetry={standings.refetch}
          />
        ) : (
          <>
            <Card style={{ marginBottom: 12, gap: 12 }}>
              <Body style={{ color: c.mutedForeground, fontSize: 13 }}>
                {hi
                  ? "यह सारांश सिर्फ आपके लिए है — बच्चों को रैंक नहीं दिखाया जाता।"
                  : "This summary is just for you — children do not see these ranks."}
              </Body>
              <Row style={{ justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 12, color: c.mutedForeground }}>
                    {hi ? "बैच कुल" : "Batch total"}
                  </Body>
                  <Title style={{ fontSize: 22 }}>{meta?.batch_total ?? 0}</Title>
                </View>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 12, color: c.mutedForeground }}>
                    {hi ? "औसत प्रति विद्यार्थी" : "Average per student"}
                  </Body>
                  <Title style={{ fontSize: 22 }}>{meta?.batch_average ?? 0}</Title>
                </View>
              </Row>
              <View style={{ gap: 6 }}>
                <Body style={{ fontSize: 12, color: c.mutedForeground }}>
                  {hi ? "स्तर वितरण" : "Tier mix"}
                </Body>
                <Row style={{ flexWrap: "wrap", gap: 6 }}>
                  {TIER_ORDER.map((tier) => {
                    const n = meta?.tier_counts?.[tier] ?? 0;
                    if (n === 0) return null;
                    const color = tierColor(tier, c);
                    return (
                      <View
                        key={tier}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          backgroundColor: c.muted,
                          borderRadius: 999,
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: color,
                          }}
                        />
                        <Text
                          style={{
                            fontFamily: bodyFamily(hi, "medium"),
                            fontSize: 12,
                            color: c.foreground,
                          }}
                        >
                          {tierLabel(tier, hi)} · {n}
                        </Text>
                      </View>
                    );
                  })}
                </Row>
              </View>
            </Card>

            <Pressable
              onPress={() => setSourcesOpen((o) => !o)}
              style={{
                backgroundColor: c.card,
                borderRadius: c.radius,
                borderWidth: 1,
                borderColor: c.border,
                padding: 14,
                marginBottom: 12,
              }}
            >
              <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <Title style={{ fontSize: 15 }}>
                  {hi ? "पुण्य कहाँ से आया" : "Where points came from"}
                </Title>
                <Ionicons
                  name={sourcesOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={c.mutedForeground}
                />
              </Row>
              {sourcesOpen ? (
                <View style={{ marginTop: 10, gap: 8 }}>
                  {bySourceEntries.length === 0 ? (
                    <Body style={{ color: c.mutedForeground }}>
                      {hi
                        ? "इस माह अभी कोई पुण्य लेन-देन नहीं।"
                        : "No Punya transactions in this month yet."}
                    </Body>
                  ) : (
                    bySourceEntries.map(([key, pts]) => (
                      <Row
                        key={key}
                        style={{ justifyContent: "space-between", alignItems: "center" }}
                      >
                        <Body>{sourceLabel(key, hi)}</Body>
                        <Body style={{ fontFamily: bodyFamily(hi, "semibold") }}>
                          {pts > 0 ? `+${pts}` : String(pts)}
                        </Body>
                      </Row>
                    ))
                  )}
                </View>
              ) : null}
            </Pressable>

            {items.length === 0 ? (
              <StateView
                status="empty"
                emptyText={
                  hi
                    ? "इस बैच में सक्रिय विद्यार्थी नहीं हैं।"
                    : "No active students in this batch."
                }
              />
            ) : (
              <View style={{ gap: 8 }}>
                <Body style={{ color: c.mutedForeground, fontSize: 13, marginBottom: 4 }}>
                  {hi
                    ? `${meta?.student_count ?? items.length} विद्यार्थी — टैप करके लेजर देखें`
                    : `${meta?.student_count ?? items.length} students — tap to open the ledger`}
                </Body>
                {items.map((row) => {
                  const color = tierColor(row.tier, c);
                  return (
                    <Pressable
                      key={row.student_id}
                      onPress={() =>
                        router.push(`/student-detail/${row.student_id}?section=punya` as never)
                      }
                      style={{
                        minHeight: 64,
                        backgroundColor: c.card,
                        borderRadius: c.radius,
                        borderWidth: 1,
                        borderColor: c.border,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: bodyFamily(hi, "semibold"),
                          fontSize: 15,
                          color: c.mutedForeground,
                          width: 28,
                          textAlign: "center",
                        }}
                      >
                        {row.rank}
                      </Text>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text
                          style={{
                            fontFamily: bodyFamily(hi, "semibold"),
                            fontSize: 15,
                            color: c.foreground,
                          }}
                          numberOfLines={1}
                        >
                          {row.full_name}
                          <Text style={{ color: c.mutedForeground, fontWeight: "400" }}>
                            {" · "}
                            {row.student_code}
                          </Text>
                        </Text>
                        <Body style={{ fontSize: 12, color: c.mutedForeground }}>
                          {monthDeltaText(row.month_points, hi)}
                        </Body>
                      </View>
                      <View
                        style={{
                          borderRadius: 999,
                          paddingHorizontal: 10,
                          paddingVertical: 3,
                          backgroundColor: c.muted,
                          borderWidth: 1,
                          borderColor: color,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: bodyFamily(hi, "semibold"),
                            fontSize: 11,
                            color,
                            letterSpacing: 0.3,
                          }}
                        >
                          {tierLabel(row.tier, hi)}
                        </Text>
                      </View>
                      <Text
                        style={{
                          fontFamily: bodyFamily(hi, "semibold"),
                          fontSize: 16,
                          color: c.foreground,
                          minWidth: 36,
                          textAlign: "right",
                        }}
                      >
                        {row.total_points}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}
