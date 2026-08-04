import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { usePunya } from "@/lib/queries";
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
      <Screen
        refreshing={punya.isRefetching}
        onRefresh={() => {
          refetch();
          punya.refetch();
        }}
        contentStyle={{ paddingBottom: 110 }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={hi ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।" : "Your student profile isn't ready yet."}
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
                <Body muted style={{ fontSize: 13 }}>{hi ? "कुल पुण्य अंक" : "Total punya points"}</Body>
                <Pill label={summary?.tier ?? "—"} tone="primary" />
              </Row>
              <Numeric style={{ fontSize: 44, marginTop: 8 }}>{summary?.total_points ?? 0}</Numeric>
            </Card>

            <Title style={{ fontSize: 17, marginLeft: 2, marginTop: 4 }}>
              {hi ? "लेन-देन" : "Transactions"}
            </Title>

            {transactions.length === 0 ? (
              <StateView status="empty" emptyText={hi ? "अभी कोई लेन-देन नहीं है।" : "No transactions yet."} />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {transactions.map((tx, i) => {
                  const positive = tx.points >= 0;
                  return (
                    <Row
                      key={tx.id}
                      style={{
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        borderBottomWidth: i < transactions.length - 1 ? 1 : 0,
                        borderBottomColor: c.border,
                      }}
                    >
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Body style={{ fontSize: 14 }}>{humanize(tx.feature_key)}</Body>
                        {tx.note ? (
                          <Body muted style={{ fontSize: 12, marginTop: 1 }} numberOfLines={2}>{tx.note}</Body>
                        ) : null}
                        <Body muted style={{ fontSize: 11, marginTop: 2 }}>{formatDate(tx.created_at)}</Body>
                      </View>
                      <Numeric style={{ fontSize: 18, color: positive ? c.successText : c.errorText }}>
                        {positive ? "+" : "-"}{Math.abs(tx.points)}
                      </Numeric>
                    </Row>
                  );
                })}
              </Card>
            )}
          </>
        )}
          </>
        )}
      </Screen>
    </View>
  );
}
