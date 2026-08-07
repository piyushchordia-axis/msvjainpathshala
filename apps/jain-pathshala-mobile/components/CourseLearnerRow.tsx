/**
 * One-line numbered learner row — status strip + inline Ionicons actions.
 */
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

export function CourseLearnerRow(props: {
  index: number;
  title: string;
  status: CourseProgressStatus;
  certifiedAt: string | null;
  certifiedByGender?: string | null;
  busy?: boolean;
  /** Tap row body (drill-down or open content). */
  onPress?: () => void;
  onStart?: () => void;
  onComplete?: () => void;
  onReopen?: () => void;
  /** Show chevron for drill-down. */
  showChevron?: boolean;
  subtitle?: string | null;
  /** Section rows use "Sec N"; catalogue / subsections use "N.". */
  indexStyle?: "sec" | "number";
}) {
  const c = useColors();
  const { hi } = useLocale();
  const certified = !!props.certifiedAt;
  const toneKey = courseStripTone(props.status, certified);
  const bg = c[toneKey];
  const fg = c.foreground;
  const iconColor = certified ? c.gold : c.primary;
  const disabled = props.busy || certified;
  const indexLabel =
    props.indexStyle === "sec" ? `Sec ${props.index}` : `${props.index}.`;
  const statusText = certified
    ? certifiedLabel(props.certifiedByGender, hi)
    : courseStatusLabel(props.status, hi);
  const meta = props.subtitle ? `${statusText} · ${props.subtitle}` : statusText;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: bg,
          borderBottomColor: c.border,
        },
      ]}
    >
      <Pressable
        onPress={props.onPress}
        onLongPress={
          certified
            ? () =>
                Alert.alert(
                  hi ? "प्रमाणित नोड" : "Certified node",
                  certifiedFrozenExplanation(hi),
                )
            : undefined
        }
        disabled={!props.onPress && !certified}
        style={styles.main}
        accessibilityRole={props.onPress ? "button" : undefined}
      >
        <Text
          style={{
            fontSize: 13,
            lineHeight: 20,
            fontFamily: bodyFamily(hi, "semibold"),
            color: fg,
            minWidth: props.indexStyle === "sec" ? 44 : 22,
          }}
          numberOfLines={1}
        >
          {indexLabel}
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
            flexShrink: 1,
            fontSize: 14,
            lineHeight: 20,
            fontFamily: bodyFamily(hi),
            color: fg,
            maxWidth: "55%",
          }}
          numberOfLines={1}
        >
          {props.title}
        </Text>
        <Text
          style={{
            flex: 1,
            fontSize: 12,
            lineHeight: 18,
            fontFamily: bodyFamily(hi),
            color: c.mutedForeground,
            minWidth: 0,
          }}
          numberOfLines={1}
        >
          · {meta}
        </Text>
        {props.showChevron ? (
          <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
        ) : null}
      </Pressable>

      {!certified ? (
        <View style={styles.actions}>
          {props.status === "not_started" && props.onStart ? (
            <IconBtn
              name="play"
              label={hi ? "शुरू" : "Start"}
              color={iconColor}
              disabled={disabled}
              onPress={props.onStart}
            />
          ) : null}
          {(props.status === "not_started" || props.status === "in_progress") &&
          props.onComplete ? (
            <IconBtn
              name="checkmark-circle"
              label={hi ? "पूर्ण" : "Complete"}
              color={c.successText}
              disabled={disabled}
              onPress={props.onComplete}
            />
          ) : null}
          {(props.status === "in_progress" || props.status === "completed") &&
          props.onReopen ? (
            <IconBtn
              name="arrow-undo"
              label={hi ? "फिर खोलें" : "Reopen"}
              color={c.mutedForeground}
              disabled={disabled}
              onPress={props.onReopen}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function IconBtn(props: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityLabel={props.label}
      hitSlop={6}
      style={{
        padding: 5,
        borderRadius: 999,
        backgroundColor: c.card,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        opacity: props.disabled ? 0.4 : 1,
      }}
    >
      <Ionicons name={props.name} size={16} color={props.color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 6,
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
});
