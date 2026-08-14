import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { bodyFamily } from "@/constants/typography";
import {
  useAdminCentres,
  useCentreSanchalaks,
  type AdminCentreRow,
} from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

function addressLine(c: AdminCentreRow): string {
  return [c.locality, c.city_name, c.state_name, c.pincode].filter(Boolean).join(", ");
}

function CentreDetail({
  centre,
  onBack,
}: {
  centre: AdminCentreRow;
  onBack: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const sanchalaks = useCentreSanchalaks(centre.id);
  const items = sanchalaks.data?.items ?? [];

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={centre.name}
        subtitle={centre.code ?? undefined}
        right={
          <Pressable onPress={onBack} hitSlop={12}>
            <Text
              style={{
                color: c.primary,
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 15,
                lineHeight: 22,
              }}
            >
              {hi ? "वापस" : "Back"}
            </Text>
          </Pressable>
        }
      />
      <Screen
        refreshing={sanchalaks.isRefetching}
        onRefresh={() => void sanchalaks.refetch()}
      >
        <Card>
          <Title style={{ fontSize: 16, marginBottom: 8, lineHeight: 24 }}>
            {hi ? "पता" : "Address"}
          </Title>
          <Body style={{ lineHeight: 22 }}>{addressLine(centre) || "—"}</Body>
          <Body muted style={{ marginTop: 12, fontSize: 13, lineHeight: 22 }}>
            {hi ? "संपर्क" : "Contact"}
          </Body>
          <Body style={{ lineHeight: 22 }}>
            {[centre.contact_phone, centre.contact_email].filter(Boolean).join(" · ") || "—"}
          </Body>
          <Row style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
            <Pill
              tone="info"
              label={
                hi
                  ? `GPS ${centre.gps_radius_meters} मी`
                  : `GPS ${centre.gps_radius_meters} m`
              }
            />
            <Pill
              tone="neutral"
              label={
                hi
                  ? `${centre.batch_count} बैच`
                  : `${centre.batch_count} batches`
              }
            />
            <Pill
              tone="success"
              label={
                hi
                  ? `${centre.active_student_count} सक्रिय`
                  : `${centre.active_student_count} active students`
              }
            />
          </Row>
        </Card>

        <Title style={{ fontSize: 16, marginTop: 8, marginBottom: 4, lineHeight: 24 }}>
          {hi ? "नियुक्त संचालक" : "Assigned Sanchalaks"}
        </Title>
        {sanchalaks.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : sanchalaks.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "संचालक लोड नहीं हुए।" : "Could not load Sanchalaks."}
            onRetry={() => void sanchalaks.refetch()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "कोई संचालक नियुक्त नहीं।" : "No Sanchalak assigned."}
          />
        ) : (
          items.map((s) => (
            <Card key={s.id}>
              <Title style={{ fontSize: 16, lineHeight: 24 }}>{s.full_name}</Title>
              <Body muted style={{ marginTop: 4, lineHeight: 22 }}>
                {s.phone}
              </Body>
            </Card>
          ))
        )}
      </Screen>
    </View>
  );
}

export default function CentresScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminCentres();
  const [selected, setSelected] = useState<AdminCentreRow | null>(null);

  if (selected) {
    return (
      <ActivityThemed accent="centres">
        <CentreDetail centre={selected} onBack={() => setSelected(null)} />
      </ActivityThemed>
    );
  }

  const items = data?.items ?? [];

  return (
    <ActivityThemed accent="centres">
      <AppHeader
        title={hi ? "केंद्र" : "Centres"}
        subtitle={hi ? "आपके दायरे के केंद्र" : "Centres in your scope"}
        showBack
        backHref="/admin/dashboard"
      />
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "केंद्र लोड नहीं हुए।" : "Could not load centres."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "कोई केंद्र नहीं मिला।" : "No centres found."}
          />
        ) : (
          items.map((centre) => (
            <Pressable key={centre.id} onPress={() => setSelected(centre)}>
              <Card>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Title style={{ fontSize: 17, lineHeight: 24 }}>{centre.name}</Title>
                    <Body muted style={{ fontSize: 12, marginTop: 2, lineHeight: 22 }}>
                      {addressLine(centre) || "—"}
                    </Body>
                  </View>
                  <Pill
                    tone={centre.status === "active" ? "success" : "neutral"}
                    label={centre.status}
                  />
                </Row>
                <Body muted style={{ fontSize: 13, marginTop: 8, lineHeight: 22 }}>
                  {hi
                    ? `${centre.batch_count} बैच · ${centre.active_student_count} विद्यार्थी`
                    : `${centre.batch_count} batches · ${centre.active_student_count} students`}
                </Body>
              </Card>
            </Pressable>
          ))
        )}
      </Screen>
    </ActivityThemed>
  );
}
