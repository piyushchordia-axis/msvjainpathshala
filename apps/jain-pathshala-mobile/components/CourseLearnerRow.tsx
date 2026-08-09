/**
 * One-line numbered learner row — status strip + inline status dropdown.
 * Row body navigates / opens content; status changes only via the pill menu.
 */
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import {
  certifiedFrozenExplanation,
  certifiedLabel,
  courseStatusLabel,
  courseStripTone,
  type CourseProgressStatus,
} from "@/lib/course-labels";

const STATUSES: CourseProgressStatus[] = [
  "not_started",
  "in_progress",
  "completed",
];

export function CourseLearnerRow(props: {
  index: number;
  title: string;
  status: CourseProgressStatus;
  certifiedAt: string | null;
  certifiedByGender?: string | null;
  busy?: boolean;
  /** Tap row body (drill-down or open content). */
  onPress?: () => void;
  /** When set, status pill opens an inline dropdown (CU11). */
  onChangeStatus?: (status: CourseProgressStatus) => void;
  /** Show chevron for drill-down. */
  showChevron?: boolean;
  subtitle?: string | null;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const certified = !!props.certifiedAt;
  const toneKey = courseStripTone(props.status, certified);
  const bg = c[toneKey];
  const fg = c.foreground;
  const statusText = certified
    ? certifiedLabel(props.certifiedByGender, hi)
    : courseStatusLabel(props.status, hi);
  const canChangeStatus = !!props.onChangeStatus && !certified;

  useEffect(() => {
    if (props.busy || certified) setMenuOpen(false);
  }, [props.busy, certified]);

  function onPillPress() {
    if (certified) {
      Alert.alert(
        hi ? "प्रमाणित नोड" : "Certified node",
        certifiedFrozenExplanation(hi),
      );
      return;
    }
    if (!canChangeStatus || props.busy) return;
    setMenuOpen((open) => !open);
  }

  function onMainPress() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    props.onPress?.();
  }

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: bg,
          borderBottomColor: c.border,
          zIndex: menuOpen ? 20 : 1,
        },
      ]}
    >
      <Pressable
        onPress={onMainPress}
        disabled={!props.onPress && !menuOpen}
        style={styles.main}
        accessibilityRole={props.onPress ? "button" : undefined}
      >
        <Text
          style={{
            fontSize: 13,
            lineHeight: 20,
            fontFamily: bodyFamily(hi, "semibold"),
            color: fg,
            minWidth: 22,
          }}
          numberOfLines={1}
        >
          {props.index}.
        </Text>
        {certified ? (
          <Ionicons
            name="star"
            size={14}
            color={c.gold}
            accessibilityLabel={hi ? "प्रमाणित" : "Certified"}
          />
        ) : null}
        <Text
          style={{
            flex: 1,
            fontSize: 14,
            lineHeight: 20,
            fontFamily: bodyFamily(hi),
            color: fg,
            minWidth: 0,
          }}
          numberOfLines={1}
        >
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text
            style={{
              fontSize: 12,
              lineHeight: 18,
              fontFamily: bodyFamily(hi),
              color: c.mutedForeground,
            }}
            numberOfLines={1}
          >
            {props.subtitle}
          </Text>
        ) : null}
        {props.showChevron ? (
          <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
        ) : null}
      </Pressable>

      {props.onChangeStatus || certified ? (
        <View style={styles.pillWrap}>
          <Pressable
            onPress={onPillPress}
            onLongPress={
              certified
                ? () =>
                    Alert.alert(
                      hi ? "प्रमाणित नोड" : "Certified node",
                      certifiedFrozenExplanation(hi),
                    )
                : undefined
            }
            disabled={props.busy || (!canChangeStatus && !certified)}
            accessibilityRole="button"
            accessibilityLabel={
              canChangeStatus
                ? hi
                  ? `स्थिति: ${statusText}. बदलने के लिए टैप करें।`
                  : `Status: ${statusText}. Tap to change.`
                : statusText
            }
            style={[
              styles.pill,
              {
                backgroundColor: c.card,
                borderColor: certified ? c.gold : c.border,
                opacity: props.busy ? 0.5 : 1,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 11,
                lineHeight: 16,
                fontFamily: bodyFamily(hi, "semibold"),
                color: certified ? c.gold : c.foreground,
                maxWidth: 110,
              }}
              numberOfLines={1}
            >
              {statusText}
            </Text>
            {canChangeStatus ? (
              <Ionicons
                name={menuOpen ? "chevron-up" : "chevron-down"}
                size={12}
                color={c.mutedForeground}
              />
            ) : null}
          </Pressable>

          {menuOpen && canChangeStatus ? (
            <View
              style={[
                styles.menu,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                },
              ]}
            >
              {STATUSES.map((status) => {
                const selected = status === props.status;
                const label = courseStatusLabel(status, hi);
                return (
                  <Pressable
                    key={status}
                    onPress={() => {
                      setMenuOpen(false);
                      if (status === props.status) return;
                      props.onChangeStatus?.(status);
                    }}
                    style={[
                      styles.menuItem,
                      {
                        backgroundColor: selected ? c.muted : "transparent",
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        lineHeight: 20,
                        fontFamily: bodyFamily(
                          hi,
                          selected ? "semibold" : "regular",
                        ),
                        color: c.foreground,
                      }}
                      numberOfLines={1}
                    >
                      {selected ? `✓ ${label}` : label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 8,
    overflow: "visible",
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  pillWrap: {
    position: "relative",
    flexShrink: 0,
    zIndex: 30,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  menu: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: 4,
    minWidth: 160,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    zIndex: 40,
    elevation: 6,
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
