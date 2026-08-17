import { memo } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { bodyFamily } from "@/constants/typography";
import { Body, Row } from "@/components/ui";
import type { AttendanceMark } from "@/lib/queries";

/** Fixed roster row stride for FlatList getItemLayout (single-line ~56px). */
export const ROSTER_ROW_HEIGHT = 56;

/**
 * Present/absent stay as one-tap primaries — they are the overwhelming majority
 * of marks and the row must stay within ROSTER_ROW_HEIGHT for getItemLayout.
 * Late and excused live behind the "More" chip: AT1 makes all four valid, and
 * without them AT3 (late = full attendance, pastoral signal) and AT2 (excused
 * excluded from the percentage) were simply unreachable from the primary
 * marking surface.
 */
const MARKS: {
  value: "present" | "absent";
  tone: "success" | "error";
}[] = [
  { value: "present", tone: "success" },
  { value: "absent", tone: "error" },
];

const SECONDARY_MARKS: { value: "late" | "excused"; en: string; hi: string }[] = [
  { value: "late", en: "Late", hi: "विलंब" },
  { value: "excused", en: "Excused", hi: "अनुमति" },
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
  /** Why the parent said the child would be away (AT4). Fetched but never shown before. */
  absenceReason?: string | null;
  hi: boolean;
  onMark: (studentId: string, value: AttendanceMark) => void;
};

function RosterRowInner({
  studentId,
  name,
  code,
  status,
  absenceReason,
  hi,
  onMark,
}: RosterRowProps) {
  __rosterRowRenderCount += 1;
  const c = useColors();

  const mark = (value: "present" | "absent") => {
    if (Platform.OS !== "web") void Haptics.selectionAsync();
    onMark(studentId, value);
  };

  /** Late/excused are set from the overflow sheet — reflect that on the chip. */
  const isSecondary = status === "late" || status === "excused";

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
            {/* The parent's own words, where they gave them — the Guruji is deciding
                about a child they know, and "wedding in the family" is the context
                that makes a pre-notified absence make sense. */}
            {specialHint
              ? `${code} · ${specialHint}${absenceReason ? ` — ${absenceReason}` : ""}`
              : code}
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
          <Pressable
            accessibilityLabel={hi ? "और विकल्प" : "More options"}
            onPress={() => {
              if (Platform.OS !== "web") void Haptics.selectionAsync();
              Alert.alert(
                hi ? "उपस्थिति चिह्नित करें" : "Mark attendance",
                name,
                [
                  ...SECONDARY_MARKS.map((s) => ({
                    text: hi ? s.hi : s.en,
                    onPress: () => onMark(studentId, s.value),
                  })),
                  { text: hi ? "रद्द करें" : "Cancel", style: "cancel" as const },
                ],
              );
            }}
            style={{
              minWidth: 40,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: isSecondary ? c.infoText : c.border,
              backgroundColor: isSecondary ? c.accent : c.card,
              borderRadius: c.radius,
              paddingVertical: 6,
              paddingHorizontal: 8,
            }}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={16}
              color={isSecondary ? c.infoText : c.inkDim}
            />
          </Pressable>
        </Row>
      </Row>
    </View>
  );
}

export const RosterRow = memo(RosterRowInner);
