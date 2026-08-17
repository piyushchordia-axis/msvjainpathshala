import { useEffect, useRef, useState } from "react";
import { Image, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet, apiPatch } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { joinUpload, safeImageMime, safeImageUploadName } from "@/lib/join-upload";
import { fonts } from "@/constants/typography";
import { Body, Button, Screen, Title } from "@/components/ui";
import type { JoinKind } from "@/lib/join";

type LookupItem = {
  id: string;
  display_code: string;
  name: string;
  has_paid: string;
  father_name?: string | null;
};

type JoinPaymentSettings = {
  payment_amount: string;
  payment_upi_id: string;
  payment_name: string;
  payment_qr_image: string;
};

const MAX_LOOKUP_FAILURES = 5;

export default function JoinCompletePaymentScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; code?: string; mobile?: string }>();
  const kind: JoinKind =
    params.kind === "shikshak" || params.kind === "sanchalak" || params.kind === "student"
      ? params.kind
      : "student";

  // Prefilled from the done screen's CTA (GST-API-02) — the family had just
  // typed both and was handed an empty form.
  const [mobile, setMobile] = useState(typeof params.mobile === "string" ? params.mobile : "");
  const [code, setCode] = useState(
    typeof params.code === "string" ? params.code.toUpperCase() : "",
  );
  const [item, setItem] = useState<LookupItem | null>(null);
  const [matches, setMatches] = useState<LookupItem[]>([]);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [shotPreviewUri, setShotPreviewUri] = useState<string | null>(null);
  const [settings, setSettings] = useState<JoinPaymentSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [failures, setFailures] = useState(0);

  const locked = failures >= MAX_LOOKUP_FAILURES;

  // When the done screen handed us both values, run the lookup once so the
  // family lands on their record, not a form.
  const autoLooked = useRef(false);
  useEffect(() => {
    if (autoLooked.current) return;
    if (typeof params.mobile === "string" && params.mobile && typeof params.code === "string" && params.code) {
      autoLooked.current = true;
      void lookup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lookup = async () => {
    if (locked) return;
    setBusy(true);
    setError(null);
    setItem(null);
    setMatches([]);
    try {
      // Mobile is the required key (the server refuses code-only lookups);
      // the code only narrows the match (GST-API-11).
      const q = new URLSearchParams({ kind, mobile: mobile.trim() });
      const trimmedCode = code.trim().toUpperCase();
      if (trimmedCode) q.set("display_code", trimmedCode);
      const [look, s] = await Promise.all([
        apiGet<{ items: LookupItem[] }>(`/v1/join/registrations/lookup?${q.toString()}`),
        apiGet<JoinPaymentSettings>(`/v1/join/settings?kind=${kind}`),
      ]);
      if (look.items.length === 0) {
        setFailures((n) => n + 1);
        setError(
          hi
            ? "पंजीकरण नहीं मिला — वही मोबाइल नंबर डालें जो पंजीकरण में दिया था।"
            : "Registration not found — use the same mobile number you registered with.",
        );
        return;
      }
      setFailures(0);
      setSettings(s);
      if (look.items.length > 1) {
        // Same mobile can hold several registrations (siblings) — let the
        // family pick instead of silently taking the first.
        setMatches(look.items);
        return;
      }
      const found = look.items[0];
      if (found.has_paid === "yes") {
        setError(hi ? "भुगतान पहले से दर्ज है" : "Payment already recorded");
      }
      setItem(found);
    } catch (e) {
      setFailures((n) => n + 1);
      setError(
        apiErrorMessage(e, hi, {
          ERR_NOT_FOUND: {
            en: "Registration not found — use the same mobile number you registered with.",
            hi: "पंजीकरण नहीं मिला — वही मोबाइल नंबर डालें जो पंजीकरण में दिया था।",
          },
        }),
      );
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
        // The registered mobile is the shared secret — the id alone no longer
        // authorises the write.
        mobile: mobile.trim(),
      });
      setDone(true);
    } catch (e) {
      // Bilingual copy keyed off error.code (GST-API-05).
      setError(apiErrorMessage(e, hi));
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
      <Body muted style={{ marginTop: 8 }}>
        {hi ? "पंजीकृत मोबाइल नंबर" : "Registered mobile number"}
      </Body>
      <TextInput
        value={mobile}
        onChangeText={setMobile}
        keyboardType="phone-pad"
        placeholder="98765 43210"
        placeholderTextColor={c.inkDim}
        style={{
          marginTop: 6,
          borderWidth: 1,
          borderColor: c.input,
          borderRadius: c.radius,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontFamily: fonts.body,
          color: c.foreground,
          backgroundColor: c.card,
        }}
      />
      <Body muted style={{ marginTop: 12 }}>
        {hi ? "पंजीकरण कोड (वैकल्पिक)" : "Registration code (optional)"}
      </Body>
      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        placeholder={kind === "student" ? "MUM-STU-00042" : "MUM-GHK-SHK-00003"}
        placeholderTextColor={c.inkDim}
        style={{
          marginTop: 6,
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
      {locked ? (
        <Body style={{ color: c.destructive, marginTop: 12 }}>
          {hi
            ? "कई प्रयास विफल रहे — कुछ मिनट रुककर फिर कोशिश करें, या अपने केंद्र से संपर्क करें।"
            : "Too many failed attempts — wait a few minutes and try again, or contact your centre."}
        </Body>
      ) : (
        <Button
          label={hi ? "खोजें" : "Look up"}
          onPress={() => void lookup()}
          loading={busy}
          disabled={!mobile.trim()}
          style={{ marginTop: 12 }}
        />
      )}

      {matches.length > 0 && !item ? (
        <View style={{ marginTop: 16, gap: 8 }}>
          <Body muted>
            {hi
              ? "इस नंबर पर एक से अधिक पंजीकरण हैं — अपना चुनें:"
              : "More than one registration uses this number — pick yours:"}
          </Body>
          {matches.map((m) => (
            <Button
              key={m.id}
              variant="outline"
              label={`${m.name} · ${m.display_code}`}
              onPress={() => {
                setError(
                  m.has_paid === "yes"
                    ? hi
                      ? "भुगतान पहले से दर्ज है"
                      : "Payment already recorded"
                    : null,
                );
                setItem(m);
              }}
            />
          ))}
        </View>
      ) : null}

      {item && settings && item.has_paid !== "yes" ? (
        <>
          <Body style={{ marginTop: 16 }}>{item.name}</Body>
          <Body style={{ fontFamily: fonts.mono, color: c.primary }}>{item.display_code}</Body>
          <Body muted style={{ marginTop: 6 }}>
            ₹{settings.payment_amount}
            {settings.payment_upi_id ? ` · ${settings.payment_upi_id}` : ""}
            {settings.payment_name ? ` · ${settings.payment_name}` : ""}
          </Body>
          {settings.payment_qr_image ? (
            // The admin-configured UPI QR — the web page shows it; a guest
            // paying from the app had to retype the UPI ID (GST-API-08).
            <Image
              source={{ uri: settings.payment_qr_image }}
              style={{
                alignSelf: "center",
                width: 180,
                height: 180,
                marginTop: 12,
                borderRadius: 8,
                backgroundColor: "#FFFFFF",
              }}
              resizeMode="contain"
            />
          ) : null}
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
                  apiErrorMessage(e, hi, {
                    ERR_VALIDATION_FAILED: {
                      en: "Upload failed — choose a clear image and try again.",
                      hi: "अपलोड विफल रहा — साफ़ छवि चुनकर पुनः प्रयास करें।",
                    },
                  }),
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
