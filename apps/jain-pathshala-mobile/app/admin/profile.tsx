import { useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader, LanguageToggle } from "@/components/AppHeader";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { UserPhotoEditor } from "@/components/UserPhotoEditor";
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
        <UserPhotoEditor
          name={user?.full_name ?? "—"}
          photoUrl={user?.photo_url}
          helperText={
            roleLabel
              ? hi
                ? `यह फोटो आपकी ${roleLabel.hi} प्रोफ़ाइल पर दिखेगी।`
                : `This photo appears on your ${roleLabel.en} profile.`
              : undefined
          }
        />

        {roleLabel ? (
          <Card>
            <Body muted style={{ fontSize: 12 }}>{hi ? "भूमिका" : "Role"}</Body>
            <Body style={{ marginTop: 2 }}>{hi ? roleLabel.hi : roleLabel.en}</Body>
          </Card>
        ) : null}

        <Card>
          <Body muted style={{ fontSize: 12 }}>{hi ? "फ़ोन" : "Phone"}</Body>
          <Body style={{ marginTop: 2 }}>{user?.phone ?? "—"}</Body>
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
