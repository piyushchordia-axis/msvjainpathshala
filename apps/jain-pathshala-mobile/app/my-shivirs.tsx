/**
 * "My shivirs" — the shivirs this account is an assigned volunteer for.
 *
 * Until volunteer assignment existed there was nothing to list, so a Guruji or
 * Sanchalak reached the scanner only by browsing the public shivir list, opening
 * the right one, and hoping the scanner card appeared. This is the surface that
 * makes an assignment visible and gives the scanner a one-tap route.
 *
 * Deliberately a top-level route rather than app/shivir/my-shivirs.tsx: the
 * latter sits beside app/shivir/[id].tsx and reads like a shivir id.
 */
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useMyShivirVolunteering } from "@/lib/queries";
import { formatDateRange } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function MyShivirsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useMyShivirVolunteering();
  const items = data?.items ?? [];

  return (
    <ActivityThemed accent="shivirs">
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <AppHeader
          title={hi ? "मेरे शिविर" : "My shivirs"}
          subtitle={
            hi ? "जिन शिविरों में आप स्वयंसेवक हैं" : "Shivirs you are a volunteer for"
          }
        />
        <Screen refreshing={isRefetching} onRefresh={refetch}>
          {isLoading ? (
            <StateView status="loading" emptyText="" />
          ) : isError ? (
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "सूची लोड नहीं हो सकी।" : "Could not load your shivirs."}
              onRetry={refetch}
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          ) : items.length === 0 ? (
            <StateView
              status="empty"
              // Says who can fix it, not just that the list is empty.
              emptyText={
                hi
                  ? "आपको किसी शिविर में स्वयंसेवक के रूप में नहीं जोड़ा गया है। संचालक या नगर व्यवस्थापक आपको जोड़ सकते हैं।"
                  : "You are not assigned to any shivir yet. A Sanchalak or city admin can add you."
              }
            />
          ) : (
            items.map((s) => {
              const name = (hi ? s.name_hi : null) ?? s.name_en;
              return (
                <Pressable key={s.id} onPress={() => router.push(`/shivir-scan/${s.id}` as Href)}>
                  {({ pressed }) => (
                    <Card style={{ opacity: pressed ? 0.85 : 1 }}>
                      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <Title style={{ fontSize: 17, flex: 1, paddingRight: 10 }}>{name}</Title>
                        <Ionicons name="scan-outline" size={20} color={c.primary} />
                      </Row>
                      <Row style={{ gap: 6, marginTop: 10 }}>
                        <Ionicons name="calendar-outline" size={15} color={c.primary} />
                        <Body style={{ fontSize: 13, color: c.primary }}>
                          {formatDateRange(s.start_date, s.end_date)}
                        </Body>
                      </Row>
                      <Row style={{ gap: 6, marginTop: 6 }}>
                        <Ionicons name="location-outline" size={15} color={c.mutedForeground} />
                        <Body muted style={{ fontSize: 13 }}>
                          {[s.location_text, s.city_name].filter(Boolean).join(", ") || "—"}
                        </Body>
                      </Row>
                      <Row style={{ gap: 8, marginTop: 12 }}>
                        {s.role_label ? <Pill tone="primary" label={s.role_label} /> : null}
                        <Pill
                          tone={s.session_count > 0 ? "neutral" : "warning"}
                          label={
                            s.session_count > 0
                              ? hi
                                ? `${s.session_count} सत्र`
                                : `${s.session_count} session${s.session_count === 1 ? "" : "s"}`
                              : hi
                                ? "कोई सत्र नहीं"
                                : "No sessions yet"
                          }
                        />
                      </Row>
                    </Card>
                  )}
                </Pressable>
              );
            })
          )}
        </Screen>
      </View>
    </ActivityThemed>
  );
}
