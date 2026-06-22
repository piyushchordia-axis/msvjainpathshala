import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { Body, Button, Card, Row, Screen, Title } from "@/components/ui";

const ROLE_LABELS: Record<string, { en: string; hi: string }> = {
  super_admin: { en: "Super admin", hi: "सुपर एडमिन" },
  state_admin: { en: "State admin", hi: "राज्य एडमिन" },
  city_admin: { en: "City admin", hi: "शहर एडमिन" },
  sanchalak: { en: "Sanchalak", hi: "संचालक" },
};

export default function ProfileScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { user, logout } = useAuth();

  const roleLabel = user ? ROLE_LABELS[user.role] : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "प्रोफ़ाइल" : "Profile"}
        subtitle={hi ? "आपका खाता" : "Your account"}
      />
      <Screen>
        <Card>
          <Row style={{ gap: 14 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: c.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="person" size={28} color={c.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Title style={{ fontSize: 19 }}>{user?.full_name ?? "—"}</Title>
              {roleLabel ? (
                <Body muted style={{ fontSize: 13, marginTop: 2 }}>{hi ? roleLabel.hi : roleLabel.en}</Body>
              ) : null}
            </View>
          </Row>
        </Card>

        <Card>
          <Body muted style={{ fontSize: 12 }}>{hi ? "फ़ोन" : "Phone"}</Body>
          <Body style={{ marginTop: 2 }}>{user?.phone ?? "—"}</Body>
        </Card>

        <Button
          label={hi ? "साइन आउट" : "Sign out"}
          variant="outline"
          icon="log-out-outline"
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
