import { useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader, LanguageToggle } from "@/components/AppHeader";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { Body, Button, Card, Kicker, Pill, Row, Screen, Title } from "@/components/ui";

export default function ProfileScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "प्रोफ़ाइल" : "Profile"} />
      <Screen>
        <Card>
          <Kicker>{hi ? "शिक्षक" : "Shikshak"}</Kicker>
          <Title style={{ fontSize: 20, marginTop: 6 }}>{user?.full_name ?? "—"}</Title>
          {user?.phone ? (
            <Body muted style={{ marginTop: 4 }}>{user.phone}</Body>
          ) : null}
          {user?.role ? (
            <Row style={{ marginTop: 10 }}>
              <Pill tone="primary" label={user.role} />
            </Row>
          ) : null}
        </Card>
        <Card>
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Title style={{ fontSize: 16 }}>{hi ? "भाषा" : "Language"}</Title>
              <Body muted style={{ marginTop: 4, fontSize: 13 }}>
                {hi ? "ऐप की भाषा चुनें" : "Choose the app language"}
              </Body>
            </View>
            <LanguageToggle />
          </Row>
        </Card>
        <Button
          label={hi ? "साइन आउट" : "Sign out"}
          icon="log-out-outline"
          variant="outline"
          onPress={async () => {
            await logout();
            router.replace("/");
          }}
        />
        <DeleteAccountButton />
      </Screen>
    </View>
  );
}
