import { useEffect, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { resolveUploadUrl } from "@/lib/api";
import { useMyIdCard } from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { StudentPhotoEditor } from "@/components/StudentPhotoEditor";
import { Body, Card, Numeric, Pill, Row, Screen, StateView } from "@/components/ui";

export default function IdCardScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const card = useMyIdCard(activeStudentId ?? undefined);
  const row = card.data;
  const pngUri = resolveUploadUrl(row?.png_url);
  const photoUrl = row?.photo_url ?? activeChild?.photo_url ?? null;
  const cardArtKey = row
    ? `${row.card_number}:${row.last_regenerated_at ?? ""}:${row.version_no}:${row.png_url}`
    : "";
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [activeStudentId, cardArtKey]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "पहचान पत्र" : "ID Card"}
        subtitle={hi ? "आपका डिजिटल पहचान पत्र" : "Your digital identity card"}
        compact
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
        ) : (
          <>
            <ChildSwitcher />

            <StudentPhotoEditor
              studentId={activeStudentId}
              name={activeChild.full_name}
              photoUrl={photoUrl}
              layout="portrait"
              ctaPlacement="end"
              primaryCta
              pickerTitle={hi ? "पहचान पत्र फोटो" : "ID card photo"}
              onUploadSuccess={async () => {
                await card.refetch();
              }}
              helperText={
                hi
                  ? "यह फोटो डिजिटल पहचान पत्र पर दिखेगी।"
                  : "This photo appears on the digital ID card."
              }
            />

            {card.isLoading ? (
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
                    ? "आपका पहचान पत्र अभी तैयार नहीं है — फोटो जोड़ने पर यह बन जाएगा, या अपने केंद्र से संपर्क करें।"
                    : "Your ID card isn't ready yet — adding a photo will create it, or ask your centre."
                }
              />
            ) : (
              <>
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  {pngUri && !imageFailed ? (
                    <Image
                      key={cardArtKey || pngUri}
                      source={{ uri: pngUri, cacheKey: cardArtKey || pngUri }}
                      recyclingKey={cardArtKey || pngUri}
                      style={{ width: "100%", aspectRatio: 480 / 640, backgroundColor: c.muted }}
                      contentFit="contain"
                      accessibilityLabel={hi ? "पहचान पत्र छवि" : "ID card image"}
                      onError={() => setImageFailed(true)}
                    />
                  ) : (
                    <View
                      style={{
                        width: "100%",
                        aspectRatio: 480 / 640,
                        backgroundColor: c.muted,
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                      }}
                    >
                      <Body muted style={{ textAlign: "center", fontSize: 13 }}>
                        {hi
                          ? "पहचान पत्र छवि लोड नहीं हुई। पुल-टू-रिफ्रेश आज़माएँ।"
                          : "Could not load the ID card image. Pull to refresh."}
                      </Body>
                    </View>
                  )}
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
                    <Numeric style={{ fontSize: 14, marginLeft: 8 }}>v{row.version_no}</Numeric>
                  </Row>
                </Card>
              </>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}
