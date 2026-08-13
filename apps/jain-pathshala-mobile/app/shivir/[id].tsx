import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet } from "@/lib/api";
import type { ShivirDetail } from "@/lib/types";
import { formatDateRange } from "@/lib/format";
import { Body, Button, Card, Screen, StateView, Title, Row as URow } from "@/components/ui";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";

export default function ShivirDetailScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["shivir", id],
    queryFn: () => apiGet<ShivirDetail>(`/v1/public/shivirs/${id}`),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <ActivityThemed accent="shivirs">
        <Screen scroll={false}><StateView status="loading" emptyText="" /></Screen>
      </ActivityThemed>
    );
  }
  if (isError || !data) {
    return (
      <ActivityThemed accent="shivirs">
        <Screen scroll={false}>
          <StateView status="error" emptyText="" errorText={hi ? "शिविर लोड नहीं हो सका।" : "Could not load this shivir."} onRetry={refetch} retryLabel={hi ? "पुनः प्रयास करें" : "Try again"} />
        </Screen>
      </ActivityThemed>
    );
  }

  return (
    <ActivityThemed accent="shivirs">
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      <Card>
        <Title>{data.name}</Title>
        <URow style={{ gap: 8, marginTop: 12 }}>
          <Ionicons name="calendar-outline" size={16} color={c.primary} />
          <Body style={{ color: c.primary }}>{formatDateRange(data.start_date, data.end_date)}</Body>
        </URow>
        <URow style={{ gap: 8, marginTop: 8 }}>
          <Ionicons name="location-outline" size={16} color={c.mutedForeground} />
          <Body muted>{[data.location_text, data.city_name, data.state_name].filter(Boolean).join(", ") || "—"}</Body>
        </URow>
        {data.capacity != null ? (
          <URow style={{ gap: 8, marginTop: 8 }}>
            <Ionicons name="people-outline" size={16} color={c.mutedForeground} />
            <Body muted>{hi ? "क्षमता" : "Capacity"}: {data.capacity}</Body>
          </URow>
        ) : null}
      </Card>

      {/* Volunteer / admin attendance scanner. Hidden from guests (they can't
          scan and would only hit a sign-in wall); for signed-in users the
          scanner screen is server-authorized and shows a friendly "not
          available" state to anyone who isn't a volunteer or in-scope admin. */}
      {user ? (
        <Card>
          <Title style={{ fontSize: 17 }}>{hi ? "उपस्थिति स्कैनर" : "Attendance scanner"}</Title>
          <Body muted style={{ marginTop: 8, lineHeight: 23 }}>
            {hi
              ? "स्वयंसेवक यहाँ विद्यार्थियों के पहचान पत्र QR स्कैन करके उपस्थिति दर्ज कर सकते हैं।"
              : "Volunteers can record attendance here by scanning students' ID-card QR codes."}
          </Body>
          <Button
            label={hi ? "QR स्कैन करें" : "Scan QR"}
            icon="scan-outline"
            onPress={() => router.push(`/shivir-scan/${data.id}` as Href)}
            style={{ marginTop: 14 }}
          />
        </Card>
      ) : null}

      {data.description ? (
        <Card>
          <Title style={{ fontSize: 17 }}>{hi ? "विवरण" : "About this shivir"}</Title>
          <Body muted style={{ marginTop: 8, lineHeight: 23 }}>{data.description}</Body>
        </Card>
      ) : null}

      {data.contact_info ? (
        <Card>
          <Title style={{ fontSize: 17 }}>{hi ? "संपर्क" : "Contact"}</Title>
          <Body muted style={{ marginTop: 8 }}>{data.contact_info}</Body>
        </Card>
      ) : null}
    </Screen>
    </ActivityThemed>
  );
}
