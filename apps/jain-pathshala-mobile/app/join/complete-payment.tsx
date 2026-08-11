import { useState } from "react";
import { Image, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ApiError, apiGet, apiPatch } from "@/lib/api";
import { joinUpload, safeImageMime, safeImageUploadName } from "@/lib/join-upload";
import { fonts } from "@/constants/typography";
import { Body, Button, Screen, Title } from "@/components/ui";
import type { JoinKind } from "@/lib/join";

export default function JoinCompletePaymentScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind: JoinKind =
    params.kind === "shikshak" || params.kind === "sanchalak" || params.kind === "student"
      ? params.kind
      : "student";

  const [code, setCode] = useState("");
  const [item, setItem] = useState<{
    id: string;
    display_code: string;
    name: string;
    has_paid: string;
  } | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [shotPreviewUri, setShotPreviewUri] = useState<string | null>(null);
  const [settings, setSettings] = useState<{
    payment_amount: string;
    payment_upi_id: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const lookup = async () => {
    setBusy(true);
    setError(null);
    try {
      const [look, s] = await Promise.all([
        apiGet<{
          items: Array<{ id: string; display_code: string; name: string; has_paid: string }>;
        }>(
          `/v1/join/registrations/lookup?kind=${kind}&display_code=${encodeURIComponent(code.trim().toUpperCase())}`,
        ),
        apiGet<{ payment_amount: string; payment_upi_id: string }>(
          `/v1/join/settings?kind=${kind}`,
        ),
      ]);
      const found = look.items[0];
      if (!found) {
        setError(hi ? "पंजीकरण नहीं मिला" : "Registration not found");
        return;
      }
      if (found.has_paid === "yes") {
        setError(hi ? "भुगतान पहले से दर्ज है" : "Payment already recorded");
        setItem(found);
        return;
      }
      setItem(found);
      setSettings(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!item || !screenshotUrl) {
      setError(hi ? "स्क्रीनशॉट अपलोड करें" : "Upload a screenshot");
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/v1/join/registrations/${item.id}/payment`, {
        kind,
        payment_screenshot_url: screenshotUrl,
        has_paid: "yes",
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  if (done && item) {
    return (
      <Screen>
        <Title>{hi ? "भुगतान दर्ज हो गया" : "Payment recorded"}</Title>
        <Title style={{ marginTop: 12, fontFamily: fonts.mono, color: c.primary }}>
          {item.display_code}
        </Title>
        <Button
          label={hi ? "होम" : "Done"}
          onPress={() => router.replace("/guest/home")}
          style={{ marginTop: 20 }}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Title>{hi ? "भुगतान पूरा करें" : "Complete payment"}</Title>
      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        placeholder={kind === "student" ? "MUM-STU-00042" : "MUM-GHK-SHK-00003"}
        placeholderTextColor={c.inkDim}
        style={{
          marginTop: 16,
          borderWidth: 1,
          borderColor: c.input,
          borderRadius: c.radius,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontFamily: fonts.mono,
          color: c.foreground,
          backgroundColor: c.card,
        }}
      />
      <Button
        label={hi ? "खोजें" : "Look up"}
        onPress={() => void lookup()}
        loading={busy}
        style={{ marginTop: 12 }}
      />

      {item && settings && item.has_paid !== "yes" ? (
        <>
          <Body style={{ marginTop: 16 }}>{item.name}</Body>
          <Body style={{ fontFamily: fonts.mono, color: c.primary }}>{item.display_code}</Body>
          <Body muted style={{ marginTop: 6 }}>
            ₹{settings.payment_amount}
            {settings.payment_upi_id ? ` · ${settings.payment_upi_id}` : ""}
          </Body>
          <Button
            label={hi ? "स्क्रीनशॉट चुनें" : "Choose screenshot"}
            variant="outline"
            style={{ marginTop: 12 }}
            disabled={busy}
            onPress={async () => {
              const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                quality: 0.8,
              });
              if (res.canceled || !res.assets[0]) return;
              const asset = res.assets[0];
              setShotPreviewUri(asset.uri);
              setBusy(true);
              setError(null);
              try {
                const up = await joinUpload({
                  uri: asset.uri,
                  name: safeImageUploadName(asset.fileName, asset.uri),
                  type: safeImageMime(asset.mimeType),
                });
                setScreenshotUrl(up.url);
              } catch (e) {
                setShotPreviewUri(null);
                setScreenshotUrl(null);
                setError(
                  e instanceof ApiError
                    ? e.message
                    : "Upload failed — choose a clear image and try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
          {shotPreviewUri || screenshotUrl ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 }}>
              <Image
                source={{ uri: shotPreviewUri ?? screenshotUrl! }}
                style={{ width: 96, height: 96, borderRadius: 8 }}
              />
              <Body muted>
                {screenshotUrl
                  ? hi
                    ? "अपलोड हो गया"
                    : "Uploaded"
                  : hi
                    ? "अपलोड हो रहा है…"
                    : "Uploading…"}
              </Body>
            </View>
          ) : null}
          <Button
            label={hi ? "भुगतान जमा करें" : "Submit payment"}
            onPress={() => void submit()}
            loading={busy}
            style={{ marginTop: 12 }}
          />
        </>
      ) : null}

      {error ? <Body style={{ color: c.destructive, marginTop: 12 }}>{error}</Body> : null}
    </Screen>
  );
}
