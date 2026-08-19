import { useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Kicker, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { punyaTierLabel } from "@/lib/punya-labels";
import { formatAgeGroup } from "@workspace/api-zod";

export default function ParentChildren() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const {
    children,
    loading,
    isError,
    activeStudentId,
    setActiveStudentId,
    refetch,
  } = useSessionView();

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "मेरे बच्चे" : "My children"}
        subtitle={hi ? "बच्चे का चयन करें" : "Choose a child to view"}
      />
      <Screen refreshing={loading} onRefresh={refetch} contentStyle={{ paddingBottom: 110 }}>
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "बच्चे लोड नहीं हुए।" : "Could not load your children."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : children.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपके खाते से कोई बच्चा जुड़ा नहीं है।"
                : "No children linked to your account yet."
            }
          />
        ) : (
          children.map((child) => {
            const active = child.id === activeStudentId;
            return (
              <Card
                key={child.id}
                style={active ? { borderColor: c.primary, borderWidth: 2 } : undefined}
              >
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Kicker>{child.student_code}</Kicker>
                    <Title style={{ fontSize: 19, marginTop: 4 }}>{child.full_name}</Title>
                  </View>
                  {active ? (
                    <Pill label={hi ? "देख रहे हैं" : "Viewing"} tone="primary" />
                  ) : null}
                </Row>
                <Body muted style={{ marginTop: 6 }}>{formatAgeGroup(child.age_group, hi ? "hi" : "en")}</Body>
                {child.centre_name ? (
                  <Body style={{ marginTop: 6 }}>{child.centre_name}</Body>
                ) : null}
                {child.batch_name ? (
                  <Body muted style={{ marginTop: 2, fontSize: 13 }}>{child.batch_name}</Body>
                ) : null}
                <Row style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <Pill
                    label={hi ? `${child.total_points} अंक` : `${child.total_points} pts`}
                    tone="info"
                  />
                  <Pill label={punyaTierLabel(child.tier, hi)} tone="neutral" />
                </Row>
                <Button
                  label={hi ? "देखें" : "View"}
                  icon="eye-outline"
                  variant={active ? "secondary" : "outline"}
                  onPress={() => {
                    setActiveStudentId(child.id);
                    router.push("/parent/home");
                  }}
                  style={{ marginTop: 14 }}
                />
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}
