/**
 * CU18 — irreversible certify confirm. Must show student name, node title, Punya.
 */
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, Title } from "@/components/ui";

export function CertifyConfirmModal(props: {
  visible: boolean;
  studentName: string;
  nodeTitle: string;
  /** Section punya; 0 for subsections (CU21). */
  punyaPoints: number;
  nodeKind: "section" | "subsection";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();

  const detail = hi
    ? props.nodeKind === "section"
      ? `आप ${props.studentName} को «${props.nodeTitle}» पर ${props.punyaPoints} पुण्य के लिए प्रमाणित कर रहे हैं।`
      : `आप ${props.studentName} को «${props.nodeTitle}» पर प्रमाणित कर रहे हैं (उप-अनुभाग — कोई पुण्य नहीं)।`
    : props.nodeKind === "section"
      ? `You are about to certify ${props.studentName} on «${props.nodeTitle}» for ${props.punyaPoints} Punya.`
      : `You are about to certify ${props.studentName} on «${props.nodeTitle}» (subsection — no Punya award).`;

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: c.foreground + "73" }]}
        onPress={props.onCancel}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.card,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              borderRadius: c.radius,
            },
          ]}
        >
          <Title style={{ fontSize: 20, lineHeight: 28 }}>
            {hi ? "इस नोड को प्रमाणित करें?" : "Certify this node?"}
          </Title>
          <Text
            style={{
              marginTop: 10,
              fontSize: 15,
              lineHeight: 24,
              color: c.foreground,
              fontFamily: bodyFamily(hi),
            }}
          >
            {detail}
          </Text>
          <Body muted style={{ marginTop: 8, lineHeight: 22 }}>
            {hi
              ? "प्रमाणन अपरिवर्तनीय है। केवल तभी आगे बढ़ें जब आप यह स्टार देना चाहते हों।"
              : "Certification is irreversible. Only continue if you mean to award this star."}
          </Body>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
            <View style={{ flex: 1 }}>
              <Button
                variant="outline"
                onPress={props.onCancel}
                disabled={props.busy}
                label={hi ? "रद्द करें" : "Cancel"}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                onPress={props.onConfirm}
                disabled={props.busy}
                loading={props.busy}
                label={hi ? "प्रमाणित करें" : "Certify"}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    padding: 20,
    borderWidth: 1,
  },
});
