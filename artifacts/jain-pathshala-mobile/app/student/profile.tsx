import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Row, Screen, StateView, Title } from "@/components/ui";

export default function StudentProfile() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { user, loading, logout } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "प्रोफ़ाइल" : "Profile"}
        subtitle={hi ? "आपका खाता" : "Your account"}
      />
      <Screen>
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : !user ? (
          <StateView status="empty" emptyText={hi ? "कोई खाता जानकारी नहीं है।" : "No account details available."} />
        ) : (
          <>
            <Card>
              <Row style={{ gap: 14 }}>
                <View
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 27,
                    backgroundColor: c.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="person" size={26} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Title style={{ fontSize: 19 }}>{user.full_name}</Title>
                  <Body muted style={{ fontSize: 13, marginTop: 2 }}>{hi ? "विद्यार्थी" : "Student"}</Body>
                </View>
              </Row>

              <View style={{ height: 1, backgroundColor: c.border, marginVertical: 14 }} />

              <View style={{ gap: 10 }}>
                {user.phone ? (
                  <Row style={{ justifyContent: "space-between" }}>
                    <Body muted style={{ fontSize: 13 }}>{hi ? "फ़ोन" : "Phone"}</Body>
                    <Body style={{ fontSize: 14 }}>{user.phone}</Body>
                  </Row>
                ) : null}
                <Row style={{ justifyContent: "space-between" }}>
                  <Body muted style={{ fontSize: 13 }}>{hi ? "भूमिका" : "Role"}</Body>
                  <Body style={{ fontSize: 14 }}>{hi ? "विद्यार्थी" : "Student"}</Body>
                </Row>
              </View>
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
          </>
        )}
      </Screen>
    </View>
  );
}
