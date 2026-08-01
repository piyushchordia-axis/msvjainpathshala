import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { apiUpload, resolveUploadUrl, ApiError } from "@/lib/api";
import { useMyIdCard, useSetStudentPhoto } from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Button, Card, Numeric, Pill, Row, Screen, StateView } from "@/components/ui";

export default function IdCardScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const card = useMyIdCard(activeStudentId ?? undefined);
  const setPhoto = useSetStudentPhoto();
  const row = card.data;
  const pngUri = resolveUploadUrl(row?.png_url);
  const photoUri = resolveUploadUrl(row?.photo_url ?? activeChild?.photo_url ?? null);
  const cardArtKey = row
    ? `${row.card_number}:${row.last_regenerated_at ?? ""}:${row.version_no}:${row.png_url}`
    : "";
  const [imageFailed, setImageFailed] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [activeStudentId, cardArtKey]);

  async function pickAndUpload(from: "camera" | "library") {
    if (!activeStudentId || uploading || setPhoto.isPending) return;

    if (from === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          hi ? "अनुमति आवश्यक" : "Permission needed",
          hi ? "कैमरा अनुमति दें।" : "Please allow camera access.",
        );
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          hi ? "अनुमति आवश्यक" : "Permission needed",
          hi ? "फोटो लाइब्रेरी की अनुमति दें।" : "Please allow photo library access.",
        );
        return;
      }
    }

    const result =
      from === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.85,
            allowsEditing: true,
            aspect: [3, 4],
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.85,
            allowsEditing: true,
            aspect: [3, 4],
          });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = (asset.mimeType ?? "image/jpeg").split(";")[0]!.trim();
    const name = asset.fileName ?? "photo.jpg";

    setUploading(true);
    try {
      const uploaded = await apiUpload(
        { uri: asset.uri, name, type: mime.startsWith("image/") ? mime : "image/jpeg" },
        "student-photos",
      );
      await setPhoto.mutateAsync({ studentId: activeStudentId, photo_url: uploaded.url });
      try {
        await Image.clearMemoryCache();
        await Image.clearDiskCache();
      } catch {
        /* best-effort cache bust */
      }
      await Promise.all([card.refetch(), refetch()]);
      Alert.alert(
        hi ? "फोटो सहेजी गई" : "Photo saved",
        hi
          ? "आपकी फोटो पहचान पत्र पर अपडेट हो गई है।"
          : "Your photo was updated on the ID card.",
      );
    } catch (err) {
      Alert.alert(
        hi ? "फोटो अपडेट नहीं हुई" : "Could not update photo",
        err instanceof ApiError
          ? err.message
          : hi
            ? "कृपया पुनः प्रयास करें।"
            : "Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  function onAddPhoto() {
    Alert.alert(
      hi ? "पहचान पत्र फोटो" : "ID card photo",
      hi ? "फोटो कहाँ से जोड़ें?" : "Where should we take the photo from?",
      [
        { text: hi ? "कैमरा" : "Camera", onPress: () => void pickAndUpload("camera") },
        { text: hi ? "गैलरी" : "Library", onPress: () => void pickAndUpload("library") },
        { text: hi ? "रद्द करें" : "Cancel", style: "cancel" },
      ],
    );
  }

  const busy = uploading || setPhoto.isPending;

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
        ) : (
          <>
            <ChildSwitcher />

            <Card>
              <Row style={{ gap: 14, alignItems: "center" }}>
                <View
                  style={{
                    width: 72,
                    height: 92,
                    borderRadius: 10,
                    overflow: "hidden",
                    backgroundColor: c.muted,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  {photoUri ? (
                    <Image
                      source={{ uri: photoUri }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                      <Body muted style={{ fontSize: 11 }}>
                        {hi ? "फोटो" : "Photo"}
                      </Body>
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 15 }}>{activeChild.full_name}</Body>
                  <Body muted style={{ marginTop: 4, fontSize: 13 }}>
                    {hi
                      ? "यह फोटो डिजिटल पहचान पत्र पर दिखेगी।"
                      : "This photo appears on the digital ID card."}
                  </Body>
                  <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                    <Button
                      label={
                        busy
                          ? hi
                            ? "सेव हो रहा है…"
                            : "Saving…"
                          : photoUri
                            ? hi
                              ? "फोटो बदलें"
                              : "Change photo"
                            : hi
                              ? "फोटो जोड़ें"
                              : "Add photo"
                      }
                      variant="outline"
                      onPress={onAddPhoto}
                      loading={busy}
                      disabled={busy}
                      style={{ minWidth: 120 }}
                    />
                  </Row>
                </View>
              </Row>
            </Card>

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
