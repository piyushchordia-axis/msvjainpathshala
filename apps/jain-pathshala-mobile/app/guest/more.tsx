import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { AppHeader, LanguageToggle } from "@/components/AppHeader";
import { Body, Button, Card, Row, Screen, Title } from "@/components/ui";

interface LinkRow {
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
}

export default function GuestMoreScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();

  const resources: LinkRow[] = [
    { label: hi ? "टीम" : "Team", sub: hi ? "नेतृत्व, संचालक और गुरुजी" : "Leadership, Sanchalaks and Gurujis", icon: "people-outline", href: "/team" as Href },
    { label: hi ? "पुण्य दीवार" : "Punya Wall", sub: hi ? "बच्चों के पूर्ण किए नियम" : "Niyams completed by children", icon: "ribbon-outline", href: "/gallery" },
  ];

  const about: LinkRow[] = [
    { label: hi ? "मार्ग चुनें" : "Choose your path", sub: hi ? "विद्यार्थी / शिक्षक / संचालक" : "Student / Shikshak / Sanchalak", icon: "git-branch-outline", href: "/join" },
    { label: hi ? "मेघ संस्कार वाटिका" : "Megh Sanskar Vatika", sub: hi ? "हमारी कहानी" : "Our story", icon: "leaf-outline", href: "/info/msv" },
    { label: hi ? "हमारे बारे में" : "About", sub: hi ? "पाठशाला के बारे में" : "About the Pathshala", icon: "information-circle-outline", href: "/info/about" },
    { label: hi ? "संपर्क करें" : "Contact", sub: hi ? "टीम से बात करें" : "Talk to the team", icon: "call-outline", href: "/info/contact" },
    // Real in-app forms now — these were static cards whose only action was a
    // mailto: link, so nothing ever reached the admin inbox (GST-API-03).
    { label: hi ? "दान करें" : "Donate", sub: hi ? "जैन शिक्षा का समर्थन करें" : "Support Jain education", icon: "heart-outline", href: "/donate" },
    { label: hi ? "पूछताछ" : "Enquire", sub: hi ? "प्रवेश के लिए पूछें" : "Ask about admission", icon: "create-outline", href: "/enquire" },
  ];

  const renderRow = (row: LinkRow) => (
    <Pressable key={row.label} onPress={() => router.push(row.href)}>
      {({ pressed }) => (
        <Row style={{ paddingVertical: 14, paddingHorizontal: 14, opacity: pressed ? 0.7 : 1, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={row.icon} size={19} color={c.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Body style={{ fontSize: 15 }}>{row.label}</Body>
            <Body muted style={{ fontSize: 12, marginTop: 1 }}>{row.sub}</Body>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.inkDim} />
        </Row>
      )}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "परिचय और अधिक" : "About & more"} subtitle={hi ? "संसाधन, जानकारी और साइन इन" : "Resources, info and sign in"} />
      <Screen contentStyle={{ paddingBottom: 110 }}>
        <Card style={{ padding: 0, overflow: "hidden" }}>{resources.map(renderRow)}</Card>

        <Title style={{ fontSize: 16, marginTop: 6, marginLeft: 2 }}>{hi ? "जानकारी" : "Information"}</Title>
        <Card style={{ padding: 0, overflow: "hidden" }}>{about.map(renderRow)}</Card>

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
          <Title style={{ fontSize: 18 }}>{hi ? "अपने खाते में जाएँ" : "Access your account"}</Title>
          <Body muted style={{ marginTop: 4 }}>
            {hi ? "अभिभावक, विद्यार्थी और शिक्षक यहाँ साइन इन करें।" : "Parents, students and teachers can sign in here."}
          </Body>
          <Button
            label={hi ? "साइन इन" : "Sign in"}
            icon="log-in-outline"
            onPress={() => router.push("/auth/sign-in")}
            style={{ marginTop: 14 }}
          />
        </Card>
      </Screen>
    </View>
  );
}
