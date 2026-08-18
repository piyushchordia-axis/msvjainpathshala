import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  groupHitsBySection,
  parseSnippetHighlight,
  type SearchHit,
} from "@/lib/library/search-query";
import { t } from "@workspace/i18n";
import { Body, Button, Card, Row, Title } from "@/components/ui";

export type LibrarySearchResultsProps = {
  hits: SearchHit[];
  loading?: boolean;
  onPressHit: (hit: SearchHit) => void;
  /**
   * §17.5 — the empty state offers to request what the reader could not find,
   * carrying their query through as the request title. Omitted (no CTA) when
   * the caller has nowhere to send them.
   */
  onRequestContent?: () => void;
};

function HighlightedSnippet({ snippet }: { snippet: string }) {
  const c = useColors();
  const parts = parseSnippetHighlight(snippet);
  if (parts.length === 0) return null;
  return (
    <Text style={{ fontSize: 13, lineHeight: 22, color: c.mutedForeground, marginTop: 4 }}>
      {parts.map((p, i) =>
        p.highlight ? (
          <Text key={i} style={{ color: c.primary, fontWeight: "600" }}>
            {p.text}
          </Text>
        ) : (
          <Text key={i}>{p.text}</Text>
        ),
      )}
    </Text>
  );
}

export function LibrarySearchResults({
  hits,
  loading,
  onPressHit,
  onRequestContent,
}: LibrarySearchResultsProps) {
  const c = useColors();
  const { hi, locale } = useLocale();
  const groups = groupHitsBySection(hits);

  if (loading) {
    return (
      <Body muted style={{ paddingVertical: 24, textAlign: "center" }}>
        {hi ? "खोज रहे हैं…" : "Searching…"}
      </Body>
    );
  }

  if (hits.length === 0) {
    return (
      <View style={{ paddingVertical: 24, alignItems: "center", gap: 12 }}>
        <Body muted style={{ textAlign: "center" }}>
          {hi ? "कोई परिणाम नहीं मिला।" : "No results found."}
        </Body>
        {onRequestContent ? (
          <Button
            label={t("libraryRequests.searchCta", locale)}
            icon="add-circle-outline"
            variant="outline"
            compact
            onPress={onRequestContent}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {groups.map((group) => (
        <View key={group.sectionId} style={{ gap: 8 }}>
          <Title style={{ fontSize: 14, lineHeight: 22, color: c.mutedForeground }}>
            {group.sectionTitle}
          </Title>
          {group.hits.map((hit, idx) => (
            <Pressable
              key={`${hit.itemId || hit.resultKind}-${idx}`}
              onPress={() => onPressHit(hit)}
              accessibilityRole="button"
              accessibilityLabel={hit.title}
            >
              <Card>
                <Row style={{ gap: 10, alignItems: "flex-start" }}>
                  <Ionicons
                    name={
                      hit.resultKind === "panchang"
                        ? "calendar-outline"
                        : hit.isTextMatch
                          ? "document-text-outline"
                          : "library-outline"
                    }
                    size={20}
                    color={c.primary}
                    style={{ marginTop: 2 }}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Title style={{ fontSize: 15, lineHeight: 22 }}>{hit.title}</Title>
                    {hit.snippet ? <HighlightedSnippet snippet={hit.snippet} /> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
                </Row>
              </Card>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}
