import { useCallback } from "react";
import { FlatList, Platform, Pressable, RefreshControl, View, type ListRenderItem } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { usePunya } from "@/lib/queries";
import type { PunyaTransaction } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { AppHeader, ProfileAvatarButton } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Card, Numeric, Pill, Row, Screen, StateView, Title } from "@/components/ui";

function humanize(key: string): string {
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function StudentPunya() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, isError, refetch } = useSessionView();
  const punya = usePunya(activeStudentId ?? undefined);

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
            <Body style={{ fontSize: 14 }}>{humanize(item.feature_key)}</Body>
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
    [c.border, c.errorText, c.successText, transactions.length],
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
                  <Pill label={summary?.tier ?? "—"} tone="primary" />
                </Row>
                <Numeric style={{ fontSize: 44, marginTop: 8 }}>{summary?.total_points ?? 0}</Numeric>
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
