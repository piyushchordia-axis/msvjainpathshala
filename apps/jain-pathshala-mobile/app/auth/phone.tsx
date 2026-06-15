import { useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { bodyFamily, fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ApiError, apiPost } from "@/lib/api";
import type { OtpSendResponse } from "@/lib/auth";
import { Body, Button, Card, Kicker, Title } from "@/components/ui";

/**
 * Step 1 of sign-in — collect the +91 number and request a one-time code.
 * Works for every role; the OTP screen routes to the right persona afterwards.
 */
export default function PhoneScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();

  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = useMemo(() => `+91${digits}`, [digits]);
  const phoneValid = digits.length === 10;

  const sendOtp = async () => {
    if (!phoneValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<OtpSendResponse & { dev_code?: string }>(
        "/api/auth/login",
        { phase: "send", phone: e164 },
      );
      router.push({
        pathname: "/auth/otp",
        params: {
          phone: e164,
          otp_token: res.otp_token,
          dev_code: res.dev_code ?? "",
        },
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : hi
              ? "ओटीपी नहीं भेजा जा सका। पुनः प्रयास करें।"
              : "Could not send OTP. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, gap: 16, paddingTop: 24 }}
      bottomOffset={20}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ backgroundColor: c.primary, borderRadius: c.radius, padding: 20 }}>
        <Kicker light>Jain Pathshala</Kicker>
        <Title light style={{ marginTop: 8 }}>
          {hi ? "अपनी पाठशाला में लॉगिन करें" : "Sign in to your Pathshala"}
        </Title>
        <Body style={{ color: "rgba(255,255,255,0.9)", marginTop: 8 }}>
          {hi
            ? "अपने केंद्र में पंजीकृत फ़ोन नंबर से लॉगिन करें। एक बार का कोड एसएमएस द्वारा भेजा जाता है।"
            : "Sign in with the phone number registered with your centre. A one-time code is sent by SMS."}
        </Body>
      </View>

      <Card>
        <Title style={{ fontSize: 22 }}>{hi ? "साइन इन" : "Sign in"}</Title>
        <Body muted style={{ marginTop: 6 }}>
          {hi
            ? "कोड पाने के लिए अपना +91 मोबाइल नंबर दर्ज करें।"
            : "Enter your +91 mobile number to receive a one-time code."}
        </Body>

        {error ? (
          <View
            style={{
              marginTop: 14,
              backgroundColor: c.errorSoft,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <Text style={{ fontFamily: bodyFamily(hi), color: c.errorText, fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 16, gap: 12 }}>
          <Text style={{ fontFamily: bodyFamily(hi, "semibold"), fontSize: 13, color: c.foreground }}>
            {hi ? "मोबाइल नंबर" : "Mobile number"}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: c.input,
              borderRadius: c.radius,
              overflow: "hidden",
            }}
          >
            <View style={{ paddingHorizontal: 12, paddingVertical: 12, backgroundColor: c.muted }}>
              <Text style={{ fontFamily: fonts.monoMedium, color: c.mutedForeground }}>+91</Text>
            </View>
            <TextInput
              value={digits}
              onChangeText={(t) => setDigits(t.replace(/\D/g, "").slice(0, 10))}
              placeholder="98765 43210"
              placeholderTextColor={c.inkDim}
              keyboardType="number-pad"
              style={{
                flex: 1,
                paddingHorizontal: 12,
                paddingVertical: 12,
                fontFamily: fonts.mono,
                fontSize: 16,
                color: c.foreground,
              }}
            />
          </View>
          <Button
            label={busy ? (hi ? "भेजा जा रहा…" : "Sending…") : hi ? "ओटीपी भेजें" : "Send OTP"}
            onPress={sendOtp}
            disabled={!phoneValid}
            loading={busy}
          />
        </View>
      </Card>
    </KeyboardAwareScrollView>
  );
}
