import { memo } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { bodyFamily } from "@/constants/typography";
import { Body, Row } from "@/components/ui";
import type { AttendanceMark } from "@/lib/queries";

/** Fixed roster row stride for FlatList getItemLayout (single-line ~56px). */
export const ROSTER_ROW_HEIGHT = 56;

const MARKS: {
  value: "present" | "absent";
  tone: "success" | "error";
}[] = [
  { value: "present", tone: "success" },
  { value: "absent", tone: "error" },
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

  const mark = (value: "present" | "absent") => {
    if (Platform.OS !== "web") void Haptics.selectionAsync();
    onMark(studentId, value);
  };

  const specialHint =
    status === "excused"
      ? hi
        ? "अनुमति (पूर्व सूचना)"
        : "Pre-notified"
      : status === "late"
        ? hi
          ? "विलंब"
          : "Late"
        : null;

  return (
    <View
      style={{
        minHeight: ROSTER_ROW_HEIGHT,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        justifyContent: "center",
      }}
    >
      <Row style={{ alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: bodyFamily(hi, "semibold"),
              fontSize: 14,
              lineHeight: 18,
              color: c.foreground,
            }}
          >
            {name}
          </Text>
          <Body muted style={{ fontSize: 11, lineHeight: 14, marginTop: 1 }} numberOfLines={1}>
            {specialHint ? `${code} · ${specialHint}` : code}
          </Body>
        </View>
        <Row style={{ gap: 6, flexShrink: 0 }}>
          {MARKS.map((m) => {
            const on = status === m.value;
            const onColor = m.tone === "success" ? c.successText : c.errorText;
            const label = hi ? (m.value === "present" ? "उपस्थित" : "अनुपस्थित") : m.value === "present" ? "Present" : "Absent";
            return (
              <Pressable
                key={m.value}
                accessibilityLabel={label}
                onPress={() => mark(m.value)}
                style={{
                  minWidth: 72,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  borderWidth: 1,
                  borderColor: on ? onColor : c.border,
                  backgroundColor: on ? c.accent : c.card,
                  borderRadius: c.radius,
                  paddingVertical: 6,
                  paddingHorizontal: 8,
                }}
              >
                <Ionicons
                  name={on ? "checkmark-circle" : "ellipse-outline"}
                  size={14}
                  color={on ? onColor : c.inkDim}
                />
                <Text
                  style={{
                    fontSize: 12,
                    color: on ? onColor : c.foreground,
                    fontFamily: bodyFamily(hi, "semibold"),
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </Row>
    </View>
  );
}

export const RosterRow = memo(RosterRowInner);
