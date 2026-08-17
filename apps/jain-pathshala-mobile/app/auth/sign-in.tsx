import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { safeReturnTo } from "@/lib/auth-return";
import { OtpSignInForm } from "@/components/OtpSignInForm";
import { Body, Card, Kicker, Title } from "@/components/ui";

/**
 * Standalone sign-in — one screen, both steps.
 *
 * This was `phone.tsx` pushing to `otp.tsx`, which meant the number stopped
 * being a field the moment a code was sent. Now the number stays put and locks,
 * and the code appears beneath it. Optional `returnTo` is honoured so gated
 * flows (library sections, shivir scan) resume after verify.
 *
 * The form itself is shared with the pre-login landing — see OtpSignInForm.
 */
export default function SignInScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const raw = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = safeReturnTo(raw);

  return (
    <KeyboardAwareScrollViewCompat
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
        <OtpSignInForm returnTo={returnTo} />
      </Card>
    </KeyboardAwareScrollViewCompat>
  );
}
