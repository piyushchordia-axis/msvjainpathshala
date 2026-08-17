/**
 * The single rendering of OTP sign-in.
 *
 * Fields, buttons and banners only — no Card, no hero — so the pre-login
 * landing drops it inside its existing Card and app/auth/sign-in.tsx frames it
 * under the maroon header. One implementation, two frames.
 *
 * This component is the reason GST-API-09 cannot come back: the earlier bug was
 * two screens each owning their own copy of the OTP form, which drifted. Do not
 * re-inline these fields anywhere — render this instead.
 */
import { useEffect } from "react";
import { BackHandler, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { bodyFamily, fonts } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useOtpSignIn } from "@/hooks/useOtpSignIn";
import { Button } from "@/components/ui";
import {
  COUNTRY_CODE,
  OTP_LENGTH,
  noCodeHintCopy,
  sendsExhaustedCopy,
} from "@/lib/otp-signin";

export function OtpSignInForm({ returnTo }: { returnTo?: Href | null }) {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const s = useOtpSignIn({ returnTo });

  const locked = s.step === "code";
  const changeNumber = s.changeNumber;

  // Merging the two steps loses the free "back pops to step 1". On Android,
  // collapse to the number instead of dropping the user out of the flow.
  useEffect(() => {
    if (!locked) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      changeNumber();
      return true;
    });
    return () => sub.remove();
  }, [locked, changeNumber]);

  const labelStyle = {
    fontFamily: bodyFamily(hi, "semibold"),
    fontSize: 13,
    color: c.foreground,
  } as const;

  return (
    <View style={{ marginTop: 16, gap: 12 }}>
      {s.error ? (
        <View
          style={{
            backgroundColor: c.errorSoft,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            gap: 8,
          }}
        >
          <Text style={{ fontFamily: bodyFamily(hi), color: c.errorText, fontSize: 13 }}>
            {s.error}
          </Text>
          {s.noAccount ? (
            <Pressable onPress={() => router.push("/join")} accessibilityRole="button">
              <Text
                style={{
                  fontFamily: bodyFamily(hi, "semibold"),
                  color: c.errorText,
                  fontSize: 13,
                  textDecorationLine: "underline",
                }}
              >
                {hi ? "पंजीकरण यात्रा शुरू करें" : "Start registration"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {s.notice ? (
        <View
          style={{
            backgroundColor: c.infoSoft,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <Text style={{ fontFamily: bodyFamily(hi), color: c.infoText, fontSize: 13 }}>
            {s.notice}
          </Text>
        </View>
      ) : null}

      <Text style={labelStyle}>{hi ? "मोबाइल नंबर" : "Mobile number"}</Text>
      {/* Same row in both steps — only `editable` and the fill change, so the
          layout never jumps and the +91 chip is not duplicated. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: c.input,
          borderRadius: c.radius,
          overflow: "hidden",
          backgroundColor: locked ? c.muted : "transparent",
        }}
      >
        <View style={{ paddingHorizontal: 12, paddingVertical: 12, backgroundColor: c.muted }}>
          <Text style={{ fontFamily: fonts.monoMedium, color: c.mutedForeground }}>
            {COUNTRY_CODE}
          </Text>
        </View>
        <TextInput
          value={s.digits}
          onChangeText={s.setDigits}
          editable={!locked}
          placeholder="98765 43210"
          placeholderTextColor={c.inkDim}
          keyboardType="number-pad"
          autoComplete="tel"
          accessibilityLabel={hi ? "मोबाइल नंबर" : "Mobile number"}
          accessibilityState={{ disabled: locked }}
          style={{
            flex: 1,
            paddingHorizontal: 12,
            paddingVertical: 12,
            fontFamily: fonts.mono,
            fontSize: 16,
            color: locked ? c.mutedForeground : c.foreground,
          }}
        />
        {/* An uneditable field with no way out is the classic OTP dead end. */}
        {locked ? (
          <Pressable
            onPress={changeNumber}
            accessibilityRole="button"
            accessibilityLabel={hi ? "नंबर बदलें" : "Change number"}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 12,
              paddingVertical: 12,
            }}
          >
            <Ionicons name="create-outline" size={15} color={c.primary} />
            <Text style={{ fontFamily: bodyFamily(hi, "semibold"), fontSize: 13, color: c.primary }}>
              {hi ? "बदलें" : "Change"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {!locked ? (
        <>
          <Button
            label={s.busy ? (hi ? "भेजा जा रहा…" : "Sending…") : hi ? "ओटीपी भेजें" : "Send OTP"}
            onPress={s.sendCode}
            // The cooldown outlives "Change number", so the button must say so
            // rather than sit enabled and quietly refuse.
            disabled={!s.phoneComplete || !s.canSendNow}
            loading={s.busy}
          />
          {s.phoneComplete && !s.canSendNow ? (
            <Text
              style={{
                fontFamily: bodyFamily(hi),
                fontSize: 12,
                textAlign: "center",
                color: c.mutedForeground,
              }}
            >
              {s.resendExhausted
                ? sendsExhaustedCopy(hi)
                : hi
                  ? `${s.resendSecondsLeft} सेकंड में फिर भेज सकते हैं`
                  : `You can send again in ${s.resendSecondsLeft}s`}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={labelStyle}>{hi ? "एक बार का कोड" : "One-time code"}</Text>
          <TextInput
            value={s.code}
            onChangeText={s.setCode}
            placeholder="123456"
            placeholderTextColor={c.inkDim}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            autoFocus
            // Neither of these existed before, so the code was hand-typed.
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            accessibilityLabel={hi ? "एक बार का कोड" : "One-time code"}
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
            label={s.busy ? (hi ? "जाँच हो रही…" : "Verifying…") : hi ? "सत्यापित करें" : "Verify"}
            onPress={() => void s.verifyCode()}
            disabled={!s.codeComplete}
            loading={s.busy}
          />

          <Pressable
            onPress={s.resendCode}
            disabled={!s.canSendNow || s.resendExhausted}
            accessibilityRole="button"
            accessibilityState={{ disabled: !s.canSendNow || s.resendExhausted }}
            style={{ paddingVertical: 6, alignItems: "center" }}
          >
            <Text
              style={{
                fontFamily: bodyFamily(hi, "medium"),
                fontSize: 13,
                textAlign: "center",
                color: s.canSendNow && !s.resendExhausted ? c.primary : c.mutedForeground,
              }}
            >
              {s.resendExhausted
                ? sendsExhaustedCopy(hi)
                : s.resendSecondsLeft > 0
                  ? hi
                    ? `कोड फिर भेजें · ${s.resendSecondsLeft} सेकंड में`
                    : `Resend code · in ${s.resendSecondsLeft}s`
                  : hi
                    ? "कोड फिर भेजें"
                    : "Resend code"}
            </Text>
          </Pressable>

          {/* Persistent, not part of an error state: an unregistered number
              gets a 200 and no SMS, so this line is the only thing that ever
              reaches that person. */}
          <Text
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 12,
              lineHeight: 18,
              color: c.mutedForeground,
            }}
          >
            {noCodeHintCopy(hi)}
          </Text>
        </>
      )}
    </View>
  );
}
