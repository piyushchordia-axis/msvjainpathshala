import { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, TextInput, View } from "react-native";
import { bodyFamily, fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, apiPost } from "@/lib/api";
import type { OtpSendResponse, OtpVerifyResponse } from "@/lib/auth";
import { routeForRole } from "@/lib/roles";
import { AppHeader } from "@/components/AppHeader";
import { GuestQuickActions } from "@/components/QuickActions";
import { Body, Button, Card, Row, Screen, Title } from "@/components/ui";

function deviceId(): string {
  return `mobile-${Date.now().toString()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Pre-login landing. Phone + OTP sign-in is inline on this screen; guests can
 * still open Centres / Shivirs / Library / Notices from the bottom tabs.
 */
export default function GuestHomeScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { signIn } = useAuth();

  const [digits, setDigits] = useState("");
  const [otp, setOtp] = useState("");
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = useMemo(() => `+91${digits}`, [digits]);
  const phoneValid = digits.length === 10;
  const otpValid = otp.length === 6;
  const awaitingOtp = !!otpToken;

  const sendOtp = async () => {
    if (!phoneValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<OtpSendResponse>(
        "/api/auth/login",
        { phase: "send", phone: e164 },
      );
      setOtpToken(res.otp_token);
      setOtp("");
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
      await signIn(res.user, res.tokens);
      router.replace(routeForRole(res.user.role));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : hi
              ? "अमान्य ओटीपी। कृपया पुनः प्रयास करें।"
              : "Invalid OTP. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const changeNumber = () => {
    setOtpToken(null);
    setOtp("");
    setError(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "जैन पाठशाला" : "Jain Pathshala"}
        subtitle={
          hi
            ? "मेघ संस्कार वाटिका नेटवर्क में आपका स्वागत है"
            : "Welcome to the Megh Sanskar Vatika network"
        }
      />
      <Screen contentStyle={{ paddingBottom: 110 }}>
        <Pressable onPress={() => router.push("/join")}>
          {({ pressed }) => (
            <Card style={{ opacity: pressed ? 0.85 : 1, marginBottom: 16 }}>
              <Row style={{ gap: 12, alignItems: "center" }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: c.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="git-branch-outline" size={20} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Title style={{ fontSize: 16 }}>
                    {hi ? "पंजीकरण यात्रा" : "Registration journey"}
                  </Title>
                  <Body muted style={{ fontSize: 13, marginTop: 2 }}>
                    {hi
                      ? "विद्यार्थी · शिक्षक गण · संचालक गण"
                      : "Student · Shikshak Gan · Sanchalak Gan"}
                  </Body>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
              </Row>
            </Card>
          )}
        </Pressable>

        <Card>
          <Title style={{ fontSize: 20 }}>
            {awaitingOtp
              ? hi
                ? "ओटीपी दर्ज करें"
                : "Enter OTP"
              : hi
                ? "अपने खाते में साइन इन करें"
                : "Sign in to your account"}
          </Title>
          {awaitingOtp ? (
            <Body muted style={{ marginTop: 6 }}>
              {hi
                ? `हमने ${e164} पर 6-अंकीय कोड भेजा।`
                : `We sent a 6-digit code to ${e164}.`}
            </Body>
          ) : null}

          {error ? (
            <View
              style={{
                marginTop: 12,
                backgroundColor: c.errorSoft,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <Text style={{ fontFamily: bodyFamily(hi), color: c.errorText, fontSize: 13 }}>
                {error}
              </Text>
            </View>
          ) : null}

          {!awaitingOtp ? (
            <View style={{ marginTop: 16, gap: 12 }}>
              <Text
                style={{
                  fontFamily: bodyFamily(hi, "semibold"),
                  fontSize: 13,
                  color: c.foreground,
                }}
              >
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
                <View
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    backgroundColor: c.muted,
                  }}
                >
                  <Text style={{ fontFamily: fonts.monoMedium, color: c.mutedForeground }}>
                    +91
                  </Text>
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
                label={
                  busy
                    ? hi
                      ? "भेजा जा रहा…"
                      : "Sending…"
                    : hi
                      ? "ओटीपी भेजें"
                      : "Send OTP"
                }
                onPress={sendOtp}
                disabled={!phoneValid}
                loading={busy}
              />
            </View>
          ) : (
            <View style={{ marginTop: 16, gap: 12 }}>
              <Text
                style={{
                  fontFamily: bodyFamily(hi, "semibold"),
                  fontSize: 13,
                  color: c.foreground,
                }}
              >
                {hi ? "एक बार का कोड" : "One-time code"}
              </Text>
              <TextInput
                value={otp}
                onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                placeholderTextColor={c.inkDim}
                keyboardType="number-pad"
                autoFocus
                style={{
                  borderWidth: 1,
                  borderColor: c.input,
                  borderRadius: c.radius,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontFamily: fonts.mono,
                  fontSize: 20,
                  letterSpacing: 6,
                  color: c.foreground,
                }}
              />
              <Button
                label={
                  busy
                    ? hi
                      ? "जाँच हो रही…"
                      : "Verifying…"
                    : hi
                      ? "साइन इन"
                      : "Sign in"
                }
                icon="log-in-outline"
                onPress={verifyOtp}
                disabled={!otpValid}
                loading={busy}
              />
              <Pressable
                onPress={changeNumber}
                style={{ paddingVertical: 6, alignItems: "center" }}
              >
                <Text
                  style={{
                    fontFamily: bodyFamily(hi, "medium"),
                    color: c.mutedForeground,
                  }}
                >
                  ← {hi ? "नंबर बदलें" : "Change number"}
                </Text>
              </Pressable>
            </View>
          )}
        </Card>

        <Title style={{ fontSize: 16, marginTop: 4, marginLeft: 2 }}>
          {hi ? "बिना साइन इन देखें" : "Browse without signing in"}
        </Title>
        <Body muted style={{ marginLeft: 2, marginBottom: 4, fontSize: 13 }}>
          {hi
            ? "केंद्र, शिविर और अन्य जानकारी खुली रहती है।"
            : "Centres, shivirs and other public info stay open."}
        </Body>
        <GuestQuickActions />
      </Screen>
    </View>
  );
}
