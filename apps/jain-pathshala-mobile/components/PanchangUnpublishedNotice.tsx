/**
 * Shown when no verified Panchang exists for the year on screen.
 *
 * The app used to ship a generated year — arithmetic tithi progression that put
 * Samvatsari three weeks early — and presented it exactly like transcribed data.
 * §17.6.1 allows only a year transcribed from a published Tapagachh Panchang and
 * verified by a named authority, so when there is none the honest thing is to
 * show nothing and say why.
 *
 * What stays visible is sunrise, sunset and the Pachchakkhan times. Those are
 * computed astronomy for the reader's own city, not religious transcription, and
 * they are the part a family opens this screen for daily. Hiding them too would
 * be a second wrong answer.
 *
 * One component, used by both the month and the day screen, so the two cannot
 * end up explaining the same absence differently.
 */
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, Card, Row, Title } from "@/components/ui";

export function PanchangUnpublishedNotice({ year }: { year: number }) {
  const c = useColors();
  const { hi } = useLocale();

  return (
    <Card style={{ marginBottom: 14, borderWidth: 1, borderColor: c.border }}>
      <Row style={{ gap: 10, alignItems: "flex-start" }}>
        <Ionicons
          name="information-circle-outline"
          size={20}
          color={c.secondary}
          style={{ marginTop: 1 }}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Title style={{ fontSize: 15, lineHeight: 22 }}>
            {hi
              ? `${year} का पंचांग अभी प्रकाशित नहीं हुआ`
              : `Panchang for ${year} is not published yet`}
          </Title>
          <Body muted style={{ marginTop: 6, fontSize: 13, lineHeight: 20 }}>
            {hi
              ? "तिथि, पक्ष और पर्व दिन तब दिखाए जाएँगे जब पंचांग लिपिबद्ध और सत्यापित हो जाएगा। सूर्योदय, सूर्यास्त और पच्चक्खाण समय आपके शहर के लिए गणना किए जाते हैं और यहाँ उपलब्ध हैं।"
              : "Tithi, paksha and parv days will appear once the Panchang has been transcribed and verified. Sunrise, sunset and Pachchakkhan times are calculated for your city and are available below."}
          </Body>
        </View>
      </Row>
    </Card>
  );
}
