/**
 * Top-level course catalogue card — folder/directory metaphor.
 * Sections and subsections stay on CourseLearnerRow; do not reuse this there.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";

export function CourseFolderCard(props: {
  title: string;
  subtitle?: string | null;
  onPress: () => void;
  /** Course-level certificate chip — sits on the right of the folder header. */
  certificateLabel?: string | null;
  onCertificatePress?: () => void;
  showChevron?: boolean;
  children?: ReactNode;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const hasCert = !!props.certificateLabel && !!props.onCertificatePress;

  return (
    <View>
      <View
        style={[
          styles.tab,
          { backgroundColor: c.muted, borderColor: c.border },
        ]}
      />
      <View
        style={[
          styles.body,
          {
            backgroundColor: c.card,
            borderColor: c.border,
            borderRadius: c.radius,
          },
        ]}
      >
        <Pressable
          onPress={props.onPress}
          accessibilityRole="button"
          accessibilityLabel={props.title}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={styles.header}
        >
          <Ionicons
            name="folder"
            size={28}
            color={c.primary}
            accessibilityLabel={hi ? "फ़ोल्डर" : "Folder"}
          />
          <View style={styles.titles}>
            <Text
              style={{
                fontSize: 16,
                lineHeight: 24,
                fontFamily: bodyFamily(hi, "semibold"),
                color: c.foreground,
              }}
              numberOfLines={2}
            >
              {props.title}
            </Text>
            {props.subtitle ? (
              <Text
                style={{
                  fontSize: 12,
                  lineHeight: 22,
                  fontFamily: bodyFamily(hi),
                  color: c.mutedForeground,
                  marginTop: 2,
                }}
                numberOfLines={1}
              >
                {props.subtitle}
              </Text>
            ) : null}
          </View>
          {props.showChevron !== false ? (
            <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
          ) : null}
          {hasCert ? (
            <Pressable
              onPress={props.onCertificatePress}
              accessibilityRole="button"
              accessibilityLabel={props.certificateLabel ?? undefined}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              style={[
                styles.cert,
                { borderColor: c.gold, backgroundColor: c.card },
              ]}
            >
              <Ionicons name="ribbon-outline" size={14} color={c.gold} />
              <Text
                style={{
                  fontSize: 11,
                  lineHeight: 22,
                  fontFamily: bodyFamily(hi, "semibold"),
                  color: c.gold,
                  // M25 — wide enough for the longer "issuing" state label.
                  maxWidth: 140,
                }}
                numberOfLines={1}
              >
                {props.certificateLabel}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
        {props.children ? (
          <View
            style={[
              styles.extra,
              { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
            ]}
          >
            {props.children}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    width: 56,
    height: 12,
    marginLeft: 12,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  body: {
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  titles: {
    flex: 1,
    minWidth: 0,
  },
  cert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  extra: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
});
