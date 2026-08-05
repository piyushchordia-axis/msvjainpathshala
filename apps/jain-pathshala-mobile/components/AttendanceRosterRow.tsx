import { memo } from "react";
import { Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { bodyFamily } from "@/constants/typography";
import { Body, Card, Row, Title } from "@/components/ui";
import type { AttendanceMark } from "@/lib/queries";

/** Fixed roster row stride for FlatList getItemLayout (Card ~118px + screen gap 14px). */
export const ROSTER_ROW_HEIGHT = 132;

const MARKS: {
  value: AttendanceMark;
  en: string;
  hi: string;
  tone: "success" | "error" | "warning" | "info";
}[] = [
  { value: "present", en: "Present", hi: "उपस्थित", tone: "success" },
  { value: "absent", en: "Absent", hi: "अनुपस्थित", tone: "error" },
  { value: "late", en: "Late", hi: "विलंब", tone: "warning" },
  { value: "excused", en: "Excused", hi: "अनुमति", tone: "info" },
];

/** Test hook — total AttendanceRosterRow render invocations since last reset. */
export let __rosterRowRenderCount = 0;

export function resetRosterRowRenderCount() {
  __rosterRowRenderCount = 0;
}

export type RosterRowProps = {
  studentId: string;
  name: string;
  code: string;
  status: AttendanceMark | undefined;
  hi: boolean;
  onMark: (studentId: string, value: AttendanceMark) => void;
};

function RosterRowInner({
  studentId,
  name,
  code,
  status,
  hi,
  onMark,
}: RosterRowProps) {
  __rosterRowRenderCount += 1;
  const c = useColors();

  return (
    <Card>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Title style={{ fontSize: 16 }}>{name}</Title>
          <Body muted style={{ fontSize: 12, marginTop: 2 }}>{code}</Body>
        </View>
      </Row>
      <Row style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {MARKS.map((m) => {
          const on = status === m.value;
          const onColor =
            m.tone === "success"
              ? c.successText
              : m.tone === "error"
                ? c.errorText
                : m.tone === "warning"
                  ? c.warningText
                  : c.infoText;
          return (
            <Pressable
              key={m.value}
              onPress={() => {
                if (Platform.OS !== "web") void Haptics.selectionAsync();
                onMark(studentId, m.value);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                borderWidth: 1,
                borderColor: on ? onColor : c.border,
                backgroundColor: on ? c.accent : c.card,
                borderRadius: 999,
                paddingVertical: 8,
                paddingHorizontal: 12,
              }}
            >
              <Ionicons
                name={on ? "radio-button-on" : "radio-button-off"}
                size={16}
                color={on ? onColor : c.inkDim}
              />
              <Body
                style={{
                  fontSize: 13,
                  color: on ? onColor : c.foreground,
                  fontFamily: bodyFamily(hi, "semibold"),
                }}
              >
                {hi ? m.hi : m.en}
              </Body>
            </Pressable>
          );
        })}
      </Row>
    </Card>
  );
}

export const RosterRow = memo(RosterRowInner);
