import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiPost } from "@/lib/api";
import {
  canAccessAdminPanel,
  type OtpSendResponse,
  type OtpVerifyResponse,
} from "@/lib/auth";
import { Body, Button, Card, Kicker, Title } from "@/components/ui";

type Phase = "phone" | "otp";

function deviceId(): string {
  return `mobile-${Date.now().toString()}-${Math.random().toString(36).slice(2, 11)}`;
}

export default function LoginScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { signIn } = useAuth();

  const [phase, setPhase] = useState<Phase>("phone");
  const [digits, setDigits] = useState("");
  const [otp, setOtp] = useState("");
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = useMemo(() => `+91${digits}`, [digits]);
  const phoneValid = digits.length === 10;
  const otpValid = otp.length === 6;

  const sendOtp = async () => {
    if (!phoneValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<OtpSendResponse>("/api/auth/login", { phase: "send", phone: e164 });
      setOtpToken(res.otp_token);
      setPhase("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send OTP. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!otpValid || !otpToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<OtpVerifyResponse>("/api/auth/login", {
        phase: "verify",
        otp_token: otpToken,
        code: otp,
        device_id: deviceId(),
      });
      if (!canAccessAdminPanel(res.user?.role)) {
        setError(hi ? "यह व्यवस्थापक खाता नहीं है।" : "Not an admin account. Parents and students use the family app.");
        setPhase("phone");
        return;
      }
      await signIn(res.user, res.tokens);
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid OTP. Please try again.");
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
        <Title light style={{ marginTop: 8 }}>{hi ? "व्यवस्थापक लॉगिन" : "Jain Pathshala admin"}</Title>
        <Body style={{ color: "rgba(255,255,255,0.9)", marginTop: 8 }}>
          {hi ? "अपने केंद्र में पंजीकृत फ़ोन नंबर से लॉगिन करें। एक बार का कोड एसएमएस द्वारा भेजा जाता है।" : "Sign in with the phone number registered with your centre. One-time codes are sent by SMS."}
        </Body>
      </View>

      <Card>
        <Title style={{ fontSize: 22 }}>{phase === "phone" ? (hi ? "साइन इन" : "Sign in") : (hi ? "ओटीपी दर्ज करें" : "Enter OTP")}</Title>
        <Body muted style={{ marginTop: 6 }}>
          {phase === "phone"
            ? hi ? "कोड पाने के लिए अपना +91 मोबाइल नंबर दर्ज करें।" : "Enter your +91 mobile number to receive a one-time code."
            : `${hi ? "हमने एक 6-अंकीय कोड भेजा" : "We sent a 6-digit code to"} ${e164}.`}
        </Body>

        {error ? (
          <View style={{ marginTop: 14, backgroundColor: c.errorSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
            <Text style={{ fontFamily: fonts.body, color: c.errorText, fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}

        {phase === "phone" ? (
          <View style={{ marginTop: 16, gap: 12 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: c.foreground }}>{hi ? "मोबाइल नंबर" : "Mobile number"}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: c.input, borderRadius: c.radius, overflow: "hidden" }}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 12, backgroundColor: c.muted }}>
                <Text style={{ fontFamily: fonts.bodyMedium, color: c.mutedForeground }}>+91</Text>
              </View>
              <TextInput
                value={digits}
                onChangeText={(t) => setDigits(t.replace(/\D/g, "").slice(0, 10))}
                placeholder="98765 43210"
                placeholderTextColor={c.inkDim}
                keyboardType="number-pad"
                style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 12, fontFamily: fonts.body, fontSize: 16, color: c.foreground }}
              />
            </View>
            <Button label={busy ? (hi ? "भेजा जा रहा…" : "Sending…") : (hi ? "ओटीपी भेजें" : "Send OTP")} onPress={sendOtp} disabled={!phoneValid} loading={busy} />
          </View>
        ) : (
          <View style={{ marginTop: 16, gap: 12 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: c.foreground }}>{hi ? "एक बार का कोड" : "One-time code"}</Text>
            <TextInput
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              placeholderTextColor={c.inkDim}
              keyboardType="number-pad"
              style={{ borderWidth: 1, borderColor: c.input, borderRadius: c.radius, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.body, fontSize: 20, letterSpacing: 6, color: c.foreground }}
            />
            <Button label={busy ? (hi ? "जाँच हो रही…" : "Verifying…") : (hi ? "सत्यापित करें" : "Verify")} onPress={verifyOtp} disabled={!otpValid} loading={busy} />
            <Pressable onPress={() => { setPhase("phone"); setOtp(""); setOtpToken(null); setError(null); }} style={{ paddingVertical: 6, alignItems: "center" }}>
              <Text style={{ fontFamily: fonts.bodyMedium, color: c.mutedForeground }}>← {hi ? "वापस" : "Back"}</Text>
            </Pressable>
          </View>
        )}
      </Card>
    </KeyboardAwareScrollView>
  );
}
