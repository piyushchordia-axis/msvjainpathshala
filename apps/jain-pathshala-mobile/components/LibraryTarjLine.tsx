import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { LibraryItemDto } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { tarjLabel, tarjLine } from "@/lib/library/helpers";

export type LibraryTarjLineProps = {
  item: LibraryItemDto;
  style?: StyleProp<ViewStyle>;
};

/**
 * §17.1.3 — one caption line under an item title: the melody the piece is sung
 * to. Metadata, not content.
 *
 * Renders null when both tarj_en and tarj_hi are empty. Most items have no
 * Tarj, so an always-present "Tarj —" label would put an empty field under
 * every title in the library; the label only earns its line when there is a
 * melody to name.
 *
 * One component rather than a snippet repeated per screen, because the same
 * item appears in the section list, in bookmarks and at the top of the reader,
 * and a caption that renders three different ways reads as three fields.
 */
export function LibraryTarjLine({ item, style }: LibraryTarjLineProps) {
  const c = useColors();
  const { hi } = useLocale();
  const value = tarjLine(item, hi);
  if (!value) return null;
  return (
    <View style={style}>
      <Text
        numberOfLines={2}
        accessibilityLabel={`${tarjLabel(hi)}: ${value}`}
        style={{
          fontFamily: bodyFamily(hi),
          fontSize: 13,
          // Devanagari ascenders need the taller line box (CLAUDE.md typography).
          lineHeight: 22,
          color: c.mutedForeground,
        }}
      >
        <Text style={{ fontFamily: bodyFamily(hi, "semibold") }}>{tarjLabel(hi)}</Text>
        {"  "}
        {value}
      </Text>
    </View>
  );
}
