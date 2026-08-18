/**
 * Progress header for a course section's subsection list.
 *
 * The subsection screen used to be a bare card of titles — the section's own
 * progress, its Punya and its certified state were all in the payload and none
 * of it was shown, so the screen read as emptier than the parent outline that
 * links to it. Everything here comes from the course tree already in cache; no
 * extra request.
 */
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, ProgressBar, Row } from "@/components/ui";
import {
  sectionProgressSummary,
  type SectionProgressInput,
} from "@/lib/course-labels";

export function CourseSectionProgress({ section }: { section: SectionProgressInput }) {
  const c = useColors();
  const { hi } = useLocale();
  const summary = sectionProgressSummary(section, hi);

  // A section with no leaves, no points and no certification has nothing to
  // report — an empty strip is worse than no strip.
  if (!summary.countLine && !summary.punyaLine && !summary.certifiedLine) return null;

  const facts = [summary.countLine, summary.punyaLine].filter(Boolean).join(" · ");

  return (
    <View style={{ gap: 8, marginBottom: 4 }}>
      <Row style={{ gap: 8 }}>
        <Body style={{ flex: 1, fontSize: 13, lineHeight: 20 }} numberOfLines={1}>
          {facts}
        </Body>
        {summary.percentLabel ? (
          <Body muted style={{ fontSize: 13, lineHeight: 20 }}>
            {summary.percentLabel}
          </Body>
        ) : null}
      </Row>

      {summary.fraction != null ? <ProgressBar value={summary.fraction} /> : null}

      {summary.certifiedLine ? (
        <Row style={{ gap: 6 }}>
          <Ionicons name="star" size={13} color={c.gold} />
          <Body muted style={{ flex: 1, fontSize: 12, lineHeight: 18 }} numberOfLines={1}>
            {summary.certifiedLine}
          </Body>
        </Row>
      ) : null}
    </View>
  );
}
