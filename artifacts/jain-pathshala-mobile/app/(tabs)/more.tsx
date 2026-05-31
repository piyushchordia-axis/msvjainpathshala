import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessAdminPanel, roleLabel } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, Title } from "@/components/ui";

interface LinkRow {
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
}

export default function MoreScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const { user } = useAuth();

  const resources: LinkRow[] = [
    { label: hi ? "सार्वजनिक पुस्तकालय" : "Public library", sub: hi ? "वीडियो, पीडीएफ़ और ऑडियो" : "Videos, PDFs and audio", icon: "library-outline", href: "/library" },
    { label: hi ? "पुण्य दीवार" : "Punya Wall", sub: hi ? "बच्चों के पूर्ण किए नियम" : "Niyams completed by children", icon: "ribbon-outline", href: "/gallery" },
  ];

  const about: LinkRow[] = [
    { label: hi ? "मेघ संस्कार वाटिका" : "Megh Sanskar Vatika", sub: hi ? "हमारी कहानी" : "Our story", icon: "leaf-outline", href: "/info/msv" },
    { label: hi ? "हमारे बारे में" : "About", sub: hi ? "पाठशाला के बारे में" : "About the Pathshala", icon: "information-circle-outline", href: "/info/about" },
    { label: hi ? "संपर्क करें" : "Contact", sub: hi ? "टीम से बात करें" : "Talk to the team", icon: "call-outline", href: "/info/contact" },
    { label: hi ? "दान करें" : "Donate", sub: hi ? "जैन शिक्षा का समर्थन करें" : "Support Jain education", icon: "heart-outline", href: "/info/donate" },
    { label: hi ? "पूछताछ" : "Enquire", sub: hi ? "प्रवेश के लिए पूछें" : "Ask about admission", icon: "create-outline", href: "/info/enquire" },
  ];

  const showAdmin = canAccessAdminPanel(user?.role);

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
      <AppHeader title={hi ? "और" : "More"} subtitle={hi ? "संसाधन, जानकारी और व्यवस्थापक" : "Resources, info and admin"} />
      <Screen contentStyle={{ paddingBottom: 110 }}>
        <Card style={{ padding: 0, overflow: "hidden" }}>{resources.map(renderRow)}</Card>

        <Title style={{ fontSize: 16, marginTop: 6, marginLeft: 2 }}>{hi ? "जानकारी" : "Information"}</Title>
        <Card style={{ padding: 0, overflow: "hidden" }}>{about.map(renderRow)}</Card>

        <Card>
          {user ? (
            <>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <Title style={{ fontSize: 18 }}>{user.full_name}</Title>
                  <Body muted style={{ marginTop: 2 }}>{user.phone}</Body>
                </View>
                <Pill tone="primary" label={roleLabel(user.role)} />
              </Row>
              {showAdmin ? (
                <Pressable onPress={() => router.push("/admin")} style={({ pressed }) => ({ marginTop: 14, opacity: pressed ? 0.7 : 1 })}>
                  <Row style={{ justifyContent: "space-between", backgroundColor: c.secondary, borderRadius: c.radius, paddingVertical: 12, paddingHorizontal: 14 }}>
                    <Row style={{ gap: 8 }}>
                      <Ionicons name="grid-outline" size={18} color={c.secondaryForeground} />
                      <Body style={{ color: c.secondaryForeground, fontSize: 15 }}>{hi ? "व्यवस्थापक डैशबोर्ड" : "Admin dashboard"}</Body>
                    </Row>
                    <Ionicons name="chevron-forward" size={18} color={c.secondaryForeground} />
                  </Row>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Pressable onPress={() => router.push("/admin/login")} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <Row style={{ justifyContent: "space-between" }}>
                <Row style={{ gap: 10 }}>
                  <Ionicons name="log-in-outline" size={20} color={c.primary} />
                  <View>
                    <Body style={{ fontSize: 15 }}>{hi ? "व्यवस्थापक लॉगिन" : "Admin sign in"}</Body>
                    <Body muted style={{ fontSize: 12, marginTop: 1 }}>{hi ? "केंद्र स्टाफ़ के लिए" : "For centre staff"}</Body>
                  </View>
                </Row>
                <Ionicons name="chevron-forward" size={18} color={c.inkDim} />
              </Row>
            </Pressable>
          )}
        </Card>
      </Screen>
    </View>
  );
}
