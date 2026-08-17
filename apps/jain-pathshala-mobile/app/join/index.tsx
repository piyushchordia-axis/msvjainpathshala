import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet } from "@/lib/api";
import { Body, Card, Screen, Title } from "@/components/ui";
import type { JoinKind } from "@/lib/join";

const PATHS: Array<{
  kind: JoinKind;
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  title_en: string;
  title_hi: string;
  sub_en: string;
  sub_hi: string;
}> = [
  {
    kind: "student",
    href: "/join/student",
    icon: "school-outline",
    title_en: "Student",
    title_hi: "विद्यार्थी",
    sub_en: "Join the MSV student journey",
    sub_hi: "MSV विद्यार्थी यात्रा में जुड़ें",
  },
  {
    kind: "shikshak",
    href: "/join/shikshak",
    icon: "people-outline",
    title_en: "Shikshak Gan",
    title_hi: "शिक्षक गण",
    sub_en: "For Guruji and Didi",
    sub_hi: "गुरुजी और दीदी के लिए",
  },
  {
    kind: "sanchalak",
    href: "/join/sanchalak",
    icon: "person-outline",
    title_en: "Sanchalak Gan",
    title_hi: "संचालक गण",
    sub_en: "For Pathshala Sanchalaks",
    sub_hi: "पाठशाला संचालकों के लिए",
  },
];

export default function JoinIndexScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  // null = unknown (loading or unreachable). Defaulting to true flashed "Open"
  // then flipped; coercing failures to false made an outage read as all three
  // paths being permanently closed (GST-API-10).
  const [openMap, setOpenMap] = useState<Record<JoinKind, boolean | null>>({
    student: null,
    shikshak: null,
    sanchalak: null,
  });

  useEffect(() => {
    void Promise.all(
      PATHS.map(async (p) => {
        try {
          const s = await apiGet<{ registration_open: boolean }>(
            `/v1/join/settings?kind=${p.kind}`,
          );
          return [p.kind, s.registration_open] as const;
        } catch {
          return [p.kind, null] as const;
        }
      }),
    ).then((rows) => setOpenMap(Object.fromEntries(rows) as Record<JoinKind, boolean | null>));
  }, []);

  return (
    <Screen scroll>
      <Title style={{ fontSize: 22 }}>{hi ? "अपना मार्ग चुनें" : "Choose your path"}</Title>
      <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
        {hi
          ? "पाठशाला परिवार से जुड़ने का रास्ता चुनें।"
          : "Pick how you want to join the Pathshala family."}
      </Body>
      {PATHS.map((p) => {
        const open = openMap[p.kind];
        // Unknown status stays tappable — the form screen re-checks and renders
        // the honest closed/error state itself.
        const tappable = open !== false;
        return (
          <Pressable
            key={p.kind}
            disabled={!tappable}
            onPress={() => tappable && router.push(p.href)}
            style={{ marginBottom: 12, opacity: tappable ? 1 : 0.55 }}
          >
            <Card style={{ padding: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: c.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={p.icon} size={20} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Title style={{ fontSize: 17 }}>{hi ? p.title_hi : p.title_en}</Title>
                  <Body muted style={{ fontSize: 13, marginTop: 2 }}>
                    {hi ? p.sub_hi : p.sub_en}
                  </Body>
                </View>
                <Body style={{ fontSize: 12, color: open ? c.primary : c.mutedForeground }}>
                  {open === null ? "…" : open ? (hi ? "खुला" : "Open") : hi ? "बंद" : "Closed"}
                </Body>
              </View>
            </Card>
          </Pressable>
        );
      })}

      {/* Registered families come back to pay — give them the way in (GST-API-02). */}
      <Pressable onPress={() => router.push("/join/complete-payment?kind=student")}>
        <Body style={{ marginTop: 8, fontSize: 13, color: c.primary }}>
          {hi ? "पहले से पंजीकृत हैं? शुल्क भुगतान करें" : "Already registered? Complete your payment"}
        </Body>
      </Pressable>
    </Screen>
  );
}
