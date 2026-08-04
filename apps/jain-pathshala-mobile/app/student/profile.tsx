import { useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { AppHeader, LanguageToggle } from "@/components/AppHeader";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { StudentPhotoEditor } from "@/components/StudentPhotoEditor";
import { Body, Button, Card, Row, Screen, StateView, Title } from "@/components/ui";

export default function StudentProfile() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { user, loading, logout } = useAuth();
  const { activeStudentId, activeChild, loading: childLoading } = useSessionView();

  const waiting = loading || childLoading;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "प्रोफ़ाइल" : "Profile"}
        subtitle={hi ? "आपका खाता" : "Your account"}
      />
      <Screen contentStyle={{ paddingBottom: 110 }}>
        {waiting ? (
          <StateView status="loading" emptyText="" />
        ) : !user ? (
          <StateView
            status="empty"
            emptyText={hi ? "कोई खाता जानकारी नहीं है।" : "No account details available."}
          />
        ) : (
          <>
            {activeStudentId && activeChild ? (
              <StudentPhotoEditor
                studentId={activeStudentId}
                name={activeChild.full_name}
                photoUrl={activeChild.photo_url}
              />
            ) : (
              <Card>
                <Title style={{ fontSize: 19 }}>{user.full_name}</Title>
                <Body muted style={{ fontSize: 13, marginTop: 2 }}>
                  {hi ? "विद्यार्थी" : "Student"}
                </Body>
              </Card>
            )}

            <Card>
              <View style={{ gap: 10 }}>
                {user.phone ? (
                  <Row style={{ justifyContent: "space-between" }}>
                    <Body muted style={{ fontSize: 13 }}>
                      {hi ? "फ़ोन" : "Phone"}
                    </Body>
                    <Body style={{ fontSize: 14 }}>{user.phone}</Body>
                  </Row>
                ) : null}
                <Row style={{ justifyContent: "space-between" }}>
                  <Body muted style={{ fontSize: 13 }}>
                    {hi ? "भूमिका" : "Role"}
                  </Body>
                  <Body style={{ fontSize: 14 }}>{hi ? "विद्यार्थी" : "Student"}</Body>
                </Row>
              </View>
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

            <Card>
              <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Title style={{ fontSize: 16 }}>{hi ? "सहायता" : "Support"}</Title>
                  <Body muted style={{ marginTop: 4, fontSize: 13 }}>
                    {hi ? "सेवा अनुरोध भेजें" : "Send a service request"}
                  </Body>
                </View>
                <Button
                  label={hi ? "खोलें" : "Open"}
                  variant="outline"
                  icon="chatbubbles-outline"
                  onPress={() => router.push("/service-requests")}
                />
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
          </>
        )}
      </Screen>
    </View>
  );
}
