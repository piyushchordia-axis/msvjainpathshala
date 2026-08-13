import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Linking, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet } from "@/lib/api";
import type { BatchItem, CentreDetail } from "@/lib/types";
import { formatTimeRange } from "@/lib/format";
import { formatAgeGroups } from "@workspace/api-zod";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";

interface CentreDetailResponse {
  centre: CentreDetail;
  batches: BatchItem[];
}

// ISO weekday: 1=Mon … 7=Sun (index 0 unused) — matches the API/web convention.
const DAYS_EN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_HI = ["", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"];
function formatDays(days: number[] | null | undefined, hi: boolean): string {
  return (days ?? []).map((d) => (hi ? DAYS_HI[d] : DAYS_EN[d]) ?? "").filter(Boolean).join(", ");
}

export default function CentreDetailScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["centre", id],
    queryFn: () => apiGet<CentreDetailResponse>(`/v1/public/centres/${id}`),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <ActivityThemed accent="centres">
        <Screen scroll={false}><StateView status="loading" emptyText="" /></Screen>
      </ActivityThemed>
    );
  }
  if (isError || !data) {
    return (
      <ActivityThemed accent="centres">
        <Screen scroll={false}>
          <StateView status="error" emptyText="" errorText={hi ? "केंद्र लोड नहीं हो सका।" : "Could not load this centre."} onRetry={refetch} retryLabel={hi ? "पुनः प्रयास करें" : "Try again"} />
        </Screen>
      </ActivityThemed>
    );
  }

  const { centre, batches } = data;

  return (
    <ActivityThemed accent="centres">
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      <Card>
        <Title>{centre.name}</Title>
        <Body muted style={{ marginTop: 6 }}>
          {[centre.locality, centre.city_name, centre.state_name].filter(Boolean).join(", ") || "—"}
          {centre.pincode ? ` · ${centre.pincode}` : ""}
        </Body>
        <View style={{ gap: 8, marginTop: 14 }}>
          {centre.contact_phone ? (
            <Row style={{ gap: 8 }}>
              <Ionicons name="call-outline" size={16} color={c.primary} />
              <Body style={{ color: c.primary }} onPress={() => Linking.openURL(`tel:${centre.contact_phone}`)}>{centre.contact_phone}</Body>
            </Row>
          ) : null}
          {centre.contact_email ? (
            <Row style={{ gap: 8 }}>
              <Ionicons name="mail-outline" size={16} color={c.primary} />
              <Body style={{ color: c.primary }} onPress={() => Linking.openURL(`mailto:${centre.contact_email}`)}>{centre.contact_email}</Body>
            </Row>
          ) : null}
        </View>
      </Card>

      <Title style={{ fontSize: 18, marginTop: 6 }}>{hi ? "बैच" : "Batches"}</Title>
      {batches.length === 0 ? (
        <Card><Body muted>{hi ? "इस केंद्र में अभी कोई बैच नहीं है।" : "No batches at this centre yet."}</Body></Card>
      ) : (
        batches.map((b) => (
          <Card key={b.id}>
            <Row style={{ justifyContent: "space-between" }}>
              <Title style={{ fontSize: 17, flex: 1 }}>{b.name}</Title>
              {b.age_groups?.length ? (
                <Pill tone="primary" label={formatAgeGroups(b.age_groups, hi ? "hi" : "en")} />
              ) : null}
            </Row>
            <Row style={{ gap: 8, marginTop: 10 }}>
              <Ionicons name="time-outline" size={15} color={c.mutedForeground} />
              <Body muted style={{ fontSize: 13 }}>
                {[formatDays(b.day_of_week, hi), formatTimeRange(b.start_time, b.end_time)].filter(Boolean).join(" · ")}
              </Body>
            </Row>
            {b.capacity != null ? (
              <Row style={{ gap: 8, marginTop: 6 }}>
                <Ionicons name="people-outline" size={15} color={c.mutedForeground} />
                <Body muted style={{ fontSize: 13 }}>{b.capacity} {hi ? "स्थान" : "seats"}</Body>
              </Row>
            ) : null}
          </Card>
        ))
      )}

      <Button
        label={hi ? "प्रवेश के लिए पूछताछ करें" : "Enquire about admission"}
        icon="create-outline"
        onPress={() => (centre.contact_phone ? Linking.openURL(`tel:${centre.contact_phone}`) : router.push("/info/enquire"))}
        style={{ marginTop: 6 }}
      />
    </Screen>
    </ActivityThemed>
  );
}
