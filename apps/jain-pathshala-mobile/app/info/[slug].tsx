import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { Linking, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, Button, Card, Kicker, Screen, Title } from "@/components/ui";

type Slug = "msv" | "about" | "contact" | "donate" | "enquire";

interface Content {
  kicker: { en: string; hi: string };
  title: { en: string; hi: string };
  body: { en: string; hi: string };
  cta?: { label: { en: string; hi: string }; icon: keyof typeof Ionicons.glyphMap; url: string };
}

const CONTENT: Record<Slug, Content> = {
  msv: {
    kicker: { en: "Megh Sanskar Vatika", hi: "मेघ संस्कार वाटिका" },
    title: { en: "The Megh Sanskar Vatika story", hi: "मेघ संस्कार वाटिका की कहानी" },
    body: {
      en: "Megh Sanskar Vatika is a network of Pathshalas nurturing the next generation of Jain families in the gentle, disciplined tradition of our ancestors — combining classical learning with the warmth modern families need.",
      hi: "मेघ संस्कार वाटिका पाठशालाओं का एक नेटवर्क है जो जैन परिवारों की अगली पीढ़ी को हमारे पूर्वजों की कोमल, अनुशासित परंपरा में पालता है।",
    },
  },
  about: {
    kicker: { en: "About", hi: "हमारे बारे में" },
    title: { en: "About Jain Pathshala", hi: "जैन पाठशाला के बारे में" },
    body: {
      en: "Jain Pathshala brings centres, shivirs, notices, library and your child's Punya together in one place — so families and Gurujis stay connected throughout the year.",
      hi: "जैन पाठशाला केंद्र, शिविर, सूचनाएँ, पुस्तकालय और आपके बच्चे का पुण्य एक ही स्थान पर लाती है — ताकि परिवार और गुरुजी पूरे वर्ष जुड़े रहें।",
    },
  },
  contact: {
    kicker: { en: "Contact", hi: "संपर्क" },
    title: { en: "Talk to the MSV team", hi: "एमएसवी टीम से बात करें" },
    body: {
      en: "Have a question about a centre, a shivir, or admissions? Reach out and the Megh Sanskar Vatika team will help you find the right Pathshala.",
      hi: "किसी केंद्र, शिविर या प्रवेश के बारे में प्रश्न है? संपर्क करें और मेघ संस्कार वाटिका टीम आपकी सहायता करेगी।",
    },
    cta: { label: { en: "Email the team", hi: "टीम को ईमेल करें" }, icon: "mail-outline", url: "mailto:hello@meghsanskarvatika.org" },
  },
  donate: {
    kicker: { en: "Donate", hi: "दान" },
    title: { en: "Support Jain education", hi: "जैन शिक्षा का समर्थन करें" },
    body: {
      en: "Your contribution helps centres run shivirs, build their libraries, and reach more children with classical Pathshala learning.",
      hi: "आपका योगदान केंद्रों को शिविर चलाने, पुस्तकालय बनाने और अधिक बच्चों तक पाठशाला शिक्षा पहुँचाने में मदद करता है।",
    },
    cta: { label: { en: "Get in touch", hi: "संपर्क करें" }, icon: "heart-outline", url: "mailto:hello@meghsanskarvatika.org" },
  },
  enquire: {
    kicker: { en: "Enquire", hi: "पूछताछ" },
    title: { en: "Get in touch", hi: "संपर्क करें" },
    body: {
      en: "Looking to enrol your child at a Pathshala near you? Browse centres to find one close by, or contact the team for help with admission.",
      hi: "अपने बच्चे को अपने पास की पाठशाला में नामांकित करना चाहते हैं? पास का केंद्र खोजें या प्रवेश के लिए टीम से संपर्क करें।",
    },
    cta: { label: { en: "Email the team", hi: "टीम को ईमेल करें" }, icon: "create-outline", url: "mailto:hello@meghsanskarvatika.org" },
  },
};

export default function InfoScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const content = CONTENT[(slug as Slug)] ?? CONTENT.about;

  return (
    <>
      <Stack.Screen options={{ title: hi ? content.kicker.hi : content.kicker.en }} />
      <Screen>
        <Card style={{ backgroundColor: c.muted }}>
          <Kicker>{hi ? content.kicker.hi : content.kicker.en}</Kicker>
          <Title style={{ marginTop: 10 }}>{hi ? content.title.hi : content.title.en}</Title>
          <Body muted style={{ marginTop: 12, lineHeight: 24 }}>{hi ? content.body.hi : content.body.en}</Body>
          {content.cta ? (
            <View style={{ marginTop: 18 }}>
              <Button label={hi ? content.cta.label.hi : content.cta.label.en} icon={content.cta.icon} onPress={() => Linking.openURL(content.cta!.url)} />
            </View>
          ) : null}
        </Card>
      </Screen>
    </>
  );
}
