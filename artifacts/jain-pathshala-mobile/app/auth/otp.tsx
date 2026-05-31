import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiPost } from "@/lib/api";
import type { OtpVerifyResponse } from "@/lib/auth";
import { routeForRole } from "@/lib/roles";
import { Body, Button, Card, Kicker, Title } from "@/components/ui";

function deviceId(): string {
  return `mobile-${Date.now().toString()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Step 2 of sign-in — verify the 6-digit code, then route to the persona home
 * that matches the authenticated user's role.
 */
export default function OtpScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{
    phone?: string | string[];
    otp_token?: string | string[];
    dev_code?: string | string[];
  }>();
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const phone = first(params.phone);
  const otp_token = first(params.otp_token);
  const dev_code = first(params.dev_code);

  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No valid token means this screen was reached out of order — send the user
  // back to step 1 instead of leaving them on a dead-end Verify button.
  useEffect(() => {
    if (!otp_token) router.replace("/auth/phone");
  }, [otp_token, router]);

  const otpValid = otp.length === 6;

  const verifyOtp = async () => {
    if (!otpValid || !otp_token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<OtpVerifyResponse>("/api/auth/login", {
        phase: "verify",
        otp_token,
        code: otp,
        device_id: deviceId(),
      });
      await signIn(res.user, res.tokens);
      router.replace(routeForRole(res.user.role));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : hi
            ? "अमान्य ओटीपी। कृपया पुनः प्रयास करें।"
            : "Invalid OTP. Please try again.",
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
          {hi ? "ओटीपी दर्ज करें" : "Enter your code"}
        </Title>
        <Body style={{ color: "rgba(255,255,255,0.9)", marginTop: 8 }}>
          {`${hi ? "हमने एक 6-अंकीय कोड भेजा" : "We sent a 6-digit code to"} ${phone}.`}
        </Body>
      </View>

      <Card>
        <Title style={{ fontSize: 22 }}>{hi ? "सत्यापन" : "Verify"}</Title>

        {dev_code ? (
          <View
            style={{
              marginTop: 12,
              backgroundColor: c.infoSoft,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <Text style={{ fontFamily: fonts.bodyMedium, color: c.infoText, fontSize: 13 }}>
              {hi ? "डेव कोड" : "Dev code"}: {dev_code}
            </Text>
          </View>
        ) : null}

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
            <Text style={{ fontFamily: fonts.body, color: c.errorText, fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 16, gap: 12 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: c.foreground }}>
            {hi ? "एक बार का कोड" : "One-time code"}
          </Text>
          <TextInput
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            placeholderTextColor={c.inkDim}
            keyboardType="number-pad"
            style={{
              borderWidth: 1,
              borderColor: c.input,
              borderRadius: c.radius,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontFamily: fonts.body,
              fontSize: 20,
              letterSpacing: 6,
              color: c.foreground,
            }}
          />
          <Button
            label={busy ? (hi ? "जाँच हो रही…" : "Verifying…") : hi ? "सत्यापित करें" : "Verify"}
            onPress={verifyOtp}
            disabled={!otpValid}
            loading={busy}
          />
          <Pressable onPress={() => router.back()} style={{ paddingVertical: 6, alignItems: "center" }}>
            <Text style={{ fontFamily: fonts.bodyMedium, color: c.mutedForeground }}>
              ← {hi ? "नंबर बदलें" : "Change number"}
            </Text>
          </Pressable>
        </View>
      </Card>
    </KeyboardAwareScrollView>
  );
}
