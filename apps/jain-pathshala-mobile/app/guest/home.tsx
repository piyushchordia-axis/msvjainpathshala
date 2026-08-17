import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { AppHeader } from "@/components/AppHeader";
import { GuestQuickActions } from "@/components/QuickActions";
import { Body, Button, Card, Row, Screen, Title } from "@/components/ui";

/**
 * Pre-login landing. Sign-in lives in the dedicated /auth flow — this screen
 * used to carry its own copy of the OTP form (same endpoint, second
 * implementation), which is exactly how the two drift apart (GST-API-09).
 */
export default function GuestHomeScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();

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
            {hi ? "अपने खाते में साइन इन करें" : "Sign in to your account"}
          </Title>
          <Body muted style={{ marginTop: 6 }}>
            {hi
              ? "मोबाइल नंबर और ओटीपी से — कोई पासवर्ड नहीं।"
              : "With your mobile number and an OTP — no password."}
          </Body>
          <Button
            label={hi ? "साइन इन करें" : "Sign in"}
            icon="log-in-outline"
            onPress={() => router.push("/auth/phone")}
            style={{ marginTop: 16 }}
          />
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
