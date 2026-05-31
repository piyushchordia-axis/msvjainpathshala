import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { LanguageToggle } from "@/components/AppHeader";
import { Body, Button, Card, Kicker, Row, Title, useWebTopInset } from "@/components/ui";

const STATS = [
  { v: "120+", en: "Active centres", hi: "सक्रिय केंद्र" },
  { v: "14,000+", en: "Children learning every week", hi: "हर सप्ताह सीखते बच्चे" },
  { v: "800+", en: "Gurujis and Didis teaching", hi: "पढ़ाते गुरुजी और दीदी" },
];

export default function HomeScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const top = useWebTopInset();

  const copy = hi
    ? {
        kicker: "मेघ संस्कार वाटिका नेटवर्क",
        heading: "जहाँ जैन शिक्षा एक आधुनिक पाठशाला से मिलती है।",
        lede: "अपने पास का केंद्र खोजें, अपने बच्चे का पुण्य देखें, शिविरों के लिए नाम लिखाएँ, और अपने गुरुजी से जुड़े रहें — सब एक ही जगह।",
        ctaCentres: "केंद्र खोजें",
        ctaSignin: "मेरी पाठशाला में लॉगिन करें",
        missionTitle: "हमारा उद्देश्य",
        missionBody:
          "हम जैन परिवारों की अगली पीढ़ी को हमारे पूर्वजों की कोमल, अनुशासित परंपरा में पालने में मदद करते हैं — पाठशाला की पारंपरिक शिक्षा को आज के परिवारों की आवश्यक गर्मजोशी और संरचना के साथ जोड़ते हुए।",
      }
    : {
        kicker: "Megh Sanskar Vatika network",
        heading: "Where Jain education meets a modern Pathshala.",
        lede: "Find a centre near you, track your child's Punya, sign up for shivirs, and stay in touch with your Guruji — all in one place.",
        ctaCentres: "Find a centre",
        ctaSignin: "Sign in to my Pathshala",
        missionTitle: "Our mission",
        missionBody:
          "We help Jain families raise the next generation in the gentle, disciplined tradition of our ancestors — combining classical Pathshala learning with the warmth and structure modern families need.",
      };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ backgroundColor: c.primary, paddingTop: top + 14, paddingHorizontal: 20, paddingBottom: 30, overflow: "hidden" }}>
        <Image
          source={require("@/assets/images/icon.png")}
          style={{ position: "absolute", right: -60, top: 10, width: 240, height: 240, opacity: 0.18 }}
          contentFit="contain"
        />
        <Row style={{ justifyContent: "flex-end" }}>
          <LanguageToggle />
        </Row>
        <Kicker light>{copy.kicker}</Kicker>
        <Title light style={{ fontSize: 30, lineHeight: 38, marginTop: 12 }}>
          {copy.heading}
        </Title>
        <Body style={{ color: "rgba(255,255,255,0.92)", marginTop: 14, fontSize: 16, lineHeight: 24 }}>
          {copy.lede}
        </Body>
        <View style={{ gap: 10, marginTop: 22 }}>
          <Button label={copy.ctaCentres} variant="secondary" icon="location" onPress={() => router.push("/centres")} />
          <Button label={copy.ctaSignin} variant="outline" icon="log-in-outline" onPress={() => router.push("/admin/login")} style={{ backgroundColor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.4)" }} />
        </View>
      </View>

      <View style={{ paddingHorizontal: 18, paddingTop: 18, gap: 12 }}>
        {STATS.map((s) => (
          <Card key={s.en}>
            <Text3xl color={c.secondary}>{s.v}</Text3xl>
            <Body muted style={{ marginTop: 4 }}>{hi ? s.hi : s.en}</Body>
          </Card>
        ))}

        <Card style={{ backgroundColor: c.muted, borderColor: c.border, marginTop: 4 }}>
          <Title style={{ fontSize: 22 }}>{copy.missionTitle}</Title>
          <Body muted style={{ marginTop: 8, lineHeight: 23 }}>{copy.missionBody}</Body>
        </Card>
      </View>
    </ScrollView>
  );
}

function Text3xl({ children, color }: { children: React.ReactNode; color: string }) {
  return <Title style={{ fontSize: 28, color }}>{children}</Title>;
}
