import { useCallback, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, View, type ListRenderItem } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { usePunya, PUNYA_LEDGER_PAGE } from "@/lib/queries";
import type { PunyaTransaction } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { punyaFeatureLabel, punyaTierLabel } from "@/lib/punya-labels";
import { AppHeader, ProfileAvatarButton } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Card, Numeric, Pill, Row, Screen, StateView, Title } from "@/components/ui";

/**
 * How far through the CURRENT tier the student is, as a percent.
 *
 * Derived from the two numbers the API returns rather than from a hardcoded
 * ladder: the thresholds are configuration (AT23) and a client copy would be
 * wrong the first time anyone edited them.
 */
function tierProgressPercent(summary: {
  total_points: number;
  points_to_next?: number | null;
}): number {
  const remaining = summary.points_to_next ?? 0;
  const nextAt = summary.total_points + remaining;
  if (nextAt <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((summary.total_points / nextAt) * 100)));
}

export default function StudentPunya() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, isError, refetch } = useSessionView();
  // Grows on "show older", so the whole ledger is reachable.
  const [limit, setLimit] = useState(PUNYA_LEDGER_PAGE);
  const punya = usePunya(activeStudentId ?? undefined, { limit });

  const summary = punya.data;
  const transactions = summary?.transactions ?? [];

  const onRefresh = useCallback(() => {
    refetch();
    punya.refetch();
  }, [refetch, punya]);

  const renderTransaction: ListRenderItem<PunyaTransaction> = useCallback(
    ({ item, index }) => {
      const positive = item.points >= 0;
      return (
        <Row
          style={{
            justifyContent: "space-between",
            alignItems: "flex-start",
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderBottomWidth: index < transactions.length - 1 ? 1 : 0,
            borderBottomColor: c.border,
          }}
        >
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Body style={{ fontSize: 14 }}>{punyaFeatureLabel(item.feature_key, hi)}</Body>
            {item.note ? (
              <Body muted style={{ fontSize: 12, marginTop: 1 }} numberOfLines={2}>
                {item.note}
              </Body>
            ) : null}
            <Body muted style={{ fontSize: 11, marginTop: 2 }}>
              {formatDate(item.created_at)}
            </Body>
          </View>
          <Numeric style={{ fontSize: 18, color: positive ? c.successText : c.errorText }}>
            {positive ? "+" : "-"}
            {Math.abs(item.points)}
          </Numeric>
        </Row>
      );
    },
    // `hi` matters now that the row label is localised — without it the ledger
    // would keep rendering the previous language after a switch.
    [c.border, c.errorText, c.successText, transactions.length, hi],
  );

  const keyExtractor = useCallback((item: PunyaTransaction) => item.id, []);

  const listHeader = (
    <>
      {loading ? (
        <StateView status="loading" emptyText="" />
      ) : !activeStudentId || !activeChild ? (
        <StateView
          status="empty"
          emptyText={
            hi ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।" : "Your student profile isn't ready yet."
          }
        />
      ) : (
        <>
          <ChildSwitcher />
          {punya.isLoading ? (
            <StateView status="loading" emptyText="" />
          ) : punya.isError || isError ? (
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "पुण्य जानकारी लोड नहीं हुई।" : "Could not load punya details."}
              onRetry={punya.refetch}
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          ) : (
            <>
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Body muted style={{ fontSize: 13 }}>
                    {hi ? "कुल पुण्य अंक" : "Total punya points"}
                  </Body>
                  <Pill label={punyaTierLabel(summary?.tier, hi)} tone="primary" />
                </Row>
                <Numeric style={{ fontSize: 44, marginTop: 8 }}>{summary?.total_points ?? 0}</Numeric>

                {/* H4 — how far to the next tier. Nothing rendered this and
                    nothing COULD: no endpoint returned the thresholds and no
                    client hardcoded them, so the one number a child actually
                    wants was unreachable from every surface. */}
                {summary?.next_tier && summary.points_to_next != null ? (
                  <View style={{ marginTop: 14, gap: 6 }}>
                    <Body muted style={{ fontSize: 13, lineHeight: 22 }}>
                      {hi
                        ? `${punyaTierLabel(summary.next_tier, hi)} तक ${summary.points_to_next} अंक शेष`
                        : `${summary.points_to_next} more to reach ${punyaTierLabel(summary.next_tier, hi)}`}
                    </Body>
                    <View
                      accessibilityRole="progressbar"
                      accessibilityLabel={
                        hi
                          ? `${punyaTierLabel(summary.next_tier, hi)} तक की प्रगति`
                          : `Progress towards ${punyaTierLabel(summary.next_tier, hi)}`
                      }
                      style={{
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: c.muted,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: c.primary,
                          width: `${tierProgressPercent(summary)}%`,
                        }}
                      />
                    </View>
                  </View>
                ) : summary?.tier === "tirthankar" ? (
                  // Nothing above Tirthankar. Say so, rather than showing an
                  // empty bar that never fills.
                  <Body muted style={{ fontSize: 13, lineHeight: 22, marginTop: 14 }}>
                    {hi ? "सर्वोच्च स्तर प्राप्त" : "Highest tier reached"}
                  </Body>
                ) : null}
              </Card>

              <Title style={{ fontSize: 17, marginLeft: 2, marginTop: 4 }}>
                {hi ? "लेन-देन" : "Transactions"}
              </Title>

              {transactions.length === 0 ? (
                <StateView
                  status="empty"
                  emptyText={hi ? "अभी कोई लेन-देन नहीं है।" : "No transactions yet."}
                />
              ) : (
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  <FlatList
                    data={transactions}
                    keyExtractor={keyExtractor}
                    renderItem={renderTransaction}
                    scrollEnabled={false}
                  />
                  {/* Never present a truncated ledger as complete — the rows
                      above will not add up to the headline total — and give the
                      student a way to actually reach the rest. */}
                  {summary?.has_more ? (
                    <Pressable
                      onPress={() => setLimit((n) => n + PUNYA_LEDGER_PAGE)}
                      disabled={punya.isFetching}
                      style={{ paddingVertical: 12, alignItems: "center" }}
                    >
                      <Body style={{ fontSize: 13, color: c.primary }}>
                        {punya.isFetching
                          ? hi
                            ? "लोड हो रहा है…"
                            : "Loading…"
                          : hi
                            ? `पुराने लेन-देन देखें (${transactions.length} दिख रहे हैं)`
                            : `Show older entries (${transactions.length} shown)`}
                      </Body>
                    </Pressable>
                  ) : null}
                </Card>
              )}
            </>
          )}
        </>
      )}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "पुण्य" : "Punya"}
        subtitle={hi ? "आपके अर्जित पुण्य अंक" : "Your earned punya points"}
        right={
          <ProfileAvatarButton
            name={activeChild?.full_name}
            photoUrl={activeChild?.photo_url}
            href="/student/profile"
          />
        }
      />
      <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0, paddingBottom: 110 }}>
        <FlatList
          data={[]}
          renderItem={() => null}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 14 }}
          refreshControl={
            <RefreshControl
              refreshing={!!punya.isRefetching}
              onRefresh={onRefresh}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={Platform.OS !== "web"}
        />
      </Screen>
    </View>
  );
}
