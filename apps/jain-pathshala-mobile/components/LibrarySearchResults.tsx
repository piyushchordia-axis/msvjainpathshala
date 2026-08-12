import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  groupHitsBySection,
  parseSnippetHighlight,
  type SearchHit,
} from "@/lib/library/search-query";
import { Body, Card, Row, Title } from "@/components/ui";

export type LibrarySearchResultsProps = {
  hits: SearchHit[];
  loading?: boolean;
  onPressHit: (hit: SearchHit) => void;
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
}: LibrarySearchResultsProps) {
  const c = useColors();
  const { hi } = useLocale();
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
      <Body muted style={{ paddingVertical: 24, textAlign: "center" }}>
        {hi ? "कोई परिणाम नहीं मिला।" : "No results found."}
      </Body>
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
