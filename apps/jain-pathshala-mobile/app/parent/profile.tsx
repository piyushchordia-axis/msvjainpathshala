import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Switch, View } from "react-native";
import { t } from "@workspace/i18n";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { AppHeader, LanguageToggle } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { StudentPhotoEditor } from "@/components/StudentPhotoEditor";
import { UserPhotoEditor } from "@/components/UserPhotoEditor";
import { apiPatch, ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth";
import { Body, Button, Card, Kicker, Pill, Row, Screen, Title } from "@/components/ui";

const ROLE_LABELS: Record<string, { en: string; hi: string }> = {
  super_admin: { en: "Super Admin", hi: "सुपर एडमिन" },
  state_admin: { en: "State Admin", hi: "राज्य एडमिन" },
  city_admin: { en: "City Admin", hi: "शहर एडमिन" },
  sanchalak: { en: "Sanchalak", hi: "संचालक" },
  shikshak: { en: "Shikshak", hi: "शिक्षक" },
  parent: { en: "Parent", hi: "अभिभावक" },
  student: { en: "Student", hi: "विद्यार्थी" },
  guest: { en: "Guest", hi: "अतिथि" },
};

export default function ParentProfile() {
  const c = useColors();
  const { hi, locale } = useLocale();
  const { user, logout, updateUser } = useAuth();
  const router = useRouter();
  const { activeStudentId, activeChild } = useSessionView();
  const [galleryBusy, setGalleryBusy] = useState(false);
  const galleryOptIn = user?.gallery_visibility_opt_in === true;

  const roleLabel = user
    ? hi
      ? ROLE_LABELS[user.role]?.hi ?? user.role
      : ROLE_LABELS[user.role]?.en ?? user.role
    : "";

  async function setGalleryVisibility(optIn: boolean) {
    if (!user || galleryBusy) return;
    setGalleryBusy(true);
    try {
      const res = await apiPatch<{
        gallery_visibility_opt_in: boolean;
        user: SessionUser;
      }>("/v1/me/gallery-visibility", { opt_in: optIn });
      await updateUser(res.user);
    } catch (err) {
      Alert.alert(
        hi ? "सहमति सहेजी नहीं गई" : "Could not save",
        err instanceof ApiError
          ? err.message
          : hi
            ? "कृपया पुनः प्रयास करें।"
            : "Please try again.",
      );
    } finally {
      setGalleryBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "प्रोफ़ाइल" : "Profile"}
        subtitle={hi ? "खाता और सेटिंग्स" : "Account & settings"}
      />
      <Screen contentStyle={{ paddingBottom: 110 }}>
        <UserPhotoEditor
          name={user?.full_name ?? "—"}
          photoUrl={user?.photo_url}
          helperText={
            hi
              ? "यह आपकी अभिभावक प्रोफ़ाइल फोटो है।"
              : "This is your parent profile photo."
          }
        />

        <Card>
          <Kicker>{hi ? "खाता" : "Account"}</Kicker>
          <Title style={{ fontSize: 20, marginTop: 4 }}>{user?.full_name ?? "—"}</Title>
          <Row style={{ marginTop: 10 }}>
            <Pill label={roleLabel} tone="primary" />
          </Row>
          {user?.phone ? (
            <Body muted style={{ marginTop: 12 }}>
              {hi ? "फ़ोन" : "Phone"}: {user.phone}
            </Body>
          ) : null}
        </Card>

        {activeStudentId && activeChild ? (
          <>
            <ChildSwitcher />
            <StudentPhotoEditor
              studentId={activeStudentId}
              name={activeChild.full_name}
              photoUrl={activeChild.photo_url}
              helperText={
                hi
                  ? "यह फोटो बच्चे की प्रोफ़ाइल और डिजिटल पहचान पत्र पर दिखेगी।"
                  : "This photo appears on your child's profile and digital ID card."
              }
            />
          </>
        ) : null}

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
              <Title style={{ fontSize: 16 }}>
                {hi ? "गैलरी में दिखाएँ" : "Gallery visibility"}
              </Title>
              <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 20 }}>
                {hi
                  ? "अपने बच्चों की स्वीकृत फ़ोटो पुण्य दीवार और सार्वजनिक साइट पर दिखाने की अनुमति दें। आप कभी भी बंद कर सकते हैं — फ़ोटो तुरंत गायब हो जाती हैं।"
                  : "Allow your children's approved photos to appear on the Punya Wall and the public site. You can turn this off at any time — photos disappear immediately."}
              </Body>
            </View>
            <Switch
              value={galleryOptIn}
              disabled={galleryBusy || !user}
              onValueChange={(v) => void setGalleryVisibility(v)}
              trackColor={{ true: c.primary, false: c.border }}
            />
          </Row>
        </Card>

        <Card>
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Title style={{ fontSize: 16 }}>{t("requests.myTitle", locale)}</Title>
              <Body muted style={{ marginTop: 4, fontSize: 13 }}>
                {t("requests.profileHint", locale)}
              </Body>
            </View>
            <Button
              label={t("requests.open", locale)}
              variant="outline"
              icon="chatbubbles-outline"
              onPress={() => router.push("/service-requests")}
            />
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
