import { Image, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useMyIdCard } from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Numeric, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function IdCardScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const card = useMyIdCard(activeStudentId ?? undefined);
  const row = card.data;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "पहचान पत्र" : "ID Card"}
        subtitle={hi ? "आपका डिजिटल पहचान पत्र" : "Your digital identity card"}
      />
      <Screen
        refreshing={card.isRefetching}
        onRefresh={() => {
          refetch();
          card.refetch();
        }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।"
                : "Your student profile isn't ready yet."
            }
          />
        ) : card.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : card.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "पहचान पत्र लोड नहीं हुआ।" : "Could not load your ID card."}
            onRetry={card.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : !row ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपका पहचान पत्र अभी तैयार नहीं है — कृपया अपने केंद्र से संपर्क करें।"
                : "Your ID card isn't ready yet — please ask your centre."
            }
          />
        ) : (
          <>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <Image
                source={{ uri: row.png_url }}
                style={{ width: "100%", aspectRatio: 1.586, backgroundColor: c.muted }}
                resizeMode="contain"
                accessibilityLabel={hi ? "पहचान पत्र छवि" : "ID card image"}
              />
            </Card>

            <Card>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Body muted style={{ fontSize: 13 }}>
                    {hi ? "कार्ड संख्या" : "Card number"}
                  </Body>
                  <Numeric medium style={{ fontSize: 20, marginTop: 4 }}>
                    {row.card_number}
                  </Numeric>
                </View>
                <Pill
                  label={
                    row.is_active
                      ? hi
                        ? "सक्रिय"
                        : "Active"
                      : hi
                        ? "निष्क्रिय"
                        : "Inactive"
                  }
                  tone={row.is_active ? "success" : "neutral"}
                />
              </Row>
              <Row style={{ marginTop: 12 }}>
                <Body muted style={{ fontSize: 13 }}>
                  {hi ? "संस्करण" : "Version"}
                </Body>
                <Numeric style={{ fontSize: 14, marginLeft: 8 }}>
                  v{row.version_no}
                </Numeric>
              </Row>
            </Card>
          </>
        )}
      </Screen>
    </View>
  );
}
