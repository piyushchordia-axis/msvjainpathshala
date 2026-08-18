import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useIsOnline } from "@/hooks/useIsOnline";
import { Body, Card, Row } from "@/components/ui";

/**
 * "You are offline — saved items still work."
 *
 * The library had no connectivity awareness at all: losing signal produced the
 * same "Could not load the library" as a server outage, and nothing said that
 * downloaded stavans were still playable. A reader on a train concluded the app
 * was broken and closed it, with forty minutes of audio sitting on the device.
 *
 * Reads `useIsOnline`, which is already wired to the single NetInfo
 * subscription React Query uses — a second listener could disagree with the one
 * the query cache is acting on.
 */
export function LibraryOfflineBanner() {
  const c = useColors();
  const { hi } = useLocale();
  const online = useIsOnline();

  if (online) return null;

  return (
    <Card style={{ backgroundColor: c.muted, marginBottom: 12 }}>
      <Row style={{ gap: 10, alignItems: "flex-start" }}>
        <Ionicons name="cloud-offline-outline" size={20} color={c.mutedForeground} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body style={{ fontSize: 14, lineHeight: 22 }}>
            {hi
              ? "आप ऑफ़लाइन हैं। डाउनलोड किए गए स्तवन और पीडीएफ अभी भी खुलते हैं।"
              : "You are offline. Downloaded stavans and PDFs still open."}
          </Body>
        </View>
      </Row>
    </Card>
  );
}
