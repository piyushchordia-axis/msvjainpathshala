import { View } from "react-native";
import type { NiyamCatalogRow } from "@/lib/types";
import { badgeLabel, dateRangeLabel, endsInDaysLabel, moreToNextBadge } from "@/lib/niyam-badges";
import { useColors } from "@/hooks/useColors";
import { NiyamListRow } from "@/components/NiyamListRow";
import { NiyamBadgeRow } from "@/components/NiyamBadgeRow";
import { Body, Pill } from "@/components/ui";

type Props = {
  row: NiyamCatalogRow;
  hi: boolean;
  onPress: () => void;
};

/** Catalog row with visible streak line + badge chips (view Niyam screens). */
export function NiyamCatalogEntry({ row, hi, onPress }: Props) {
  const c = useColors();
  const title = hi ? row.title_hi ?? row.title_en : row.title_en;
  const submitted = !!row.submitted_this_period;
  const tag = hi ? row.period_status_tag_hi ?? row.period_status_tag_en : row.period_status_tag_en;
  const period = hi ? row.period_label_hi ?? row.period_label_en : row.period_label_en;
  const range = dateRangeLabel(row.start_date, row.end_date, hi);
  const ends = endsInDaysLabel(row.end_date, hi);
  const meta = [row.niyam_type, period, range, submitted ? tag : null].filter(Boolean).join(" · ");
  const streak = row.current_streak ?? 0;
  const next = moreToNextBadge(row.niyam_type, streak);
  const unit =
    row.niyam_type === "weekly"
      ? hi
        ? "सप्ताह"
        : "weeks"
      : row.niyam_type === "monthly"
        ? hi
          ? "माह"
          : "months"
        : hi
          ? "दिन"
          : "days";

  return (
    <View>
      <NiyamListRow
        title={title}
        meta={meta}
        points={row.points}
        niyamType={row.niyam_type}
        emphasizedMeta={submitted}
        statusLabel={submitted ? (tag ?? (hi ? "प्रस्तुत" : "Submitted")) : null}
        statusTone={submitted ? "primary" : "neutral"}
        onPress={onPress}
      />
      {ends ? (
        <View style={{ marginTop: 6, marginLeft: 8 }}>
          <Pill label={ends} tone="warning" />
        </View>
      ) : null}
      <View style={{ marginTop: 8, marginLeft: 8 }}>
        <Body style={{ fontSize: 14, lineHeight: 20, fontWeight: "700", color: c.secondary }}>
          {hi ? `वर्तमान लकीर: ${streak}` : `Current streak: ${streak}`}
        </Body>
        {next ? (
          <Body style={{ fontSize: 13, lineHeight: 18, marginTop: 2, color: c.foreground }}>
            {hi
              ? `${next.remaining} और ${unit} — ${badgeLabel(next.milestone.key, true)} तक`
              : `${next.remaining} more ${unit} to your ${badgeLabel(next.milestone.key, false)}`}
          </Body>
        ) : streak > 0 ? (
          <Body style={{ fontSize: 13, lineHeight: 18, marginTop: 2, color: c.successText }}>
            {hi
              ? "इस Niyam के सभी लकीर बैज अर्जित!"
              : "All streak badges earned for this Niyam!"}
          </Body>
        ) : null}
      </View>
      <NiyamBadgeRow niyamType={row.niyam_type} earnedBadges={row.earned_badges} hi={hi} />
    </View>
  );
}
