import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, Button, Card, Row, Screen, StateView, Title } from "@/components/ui";
import { fetchGranthDirectory, granthDirectoryKey } from "@/lib/library/granth";
import {
  EMPTY_DIRECTORY,
  entryAuthor,
  entryTitle,
  librariesHoldingEntry,
  libraryName,
  pickText,
} from "@/lib/library/granth-directory";

/**
 * v3 §17.11.4 — one granth in the physical directory.
 *
 * Two ways out: read it now if it is also online (linked_item_id), or go and
 * borrow it. "Read online" only appears when a link exists — an item that was
 * unpublished since the entry was written is treated as no link at all rather
 * than as a dead action.
 */
export default function GranthEntryDetail() {
  const { entryId: rawId, sectionId: rawSection } = useLocalSearchParams<{
    entryId: string;
    sectionId?: string | string[];
  }>();
  const entryId = String(rawId ?? "");
  const sectionId = String(Array.isArray(rawSection) ? rawSection[0] : (rawSection ?? ""));
  const c = useColors();
  const { hi } = useLocale();

  const { data, isLoading } = useQuery({
    queryKey: granthDirectoryKey(sectionId),
    queryFn: () => fetchGranthDirectory(sectionId),
    enabled: !!sectionId,
  });
  const directory = data ?? EMPTY_DIRECTORY;

  const entry = useMemo(
    () => directory.entries.find((e) => e.id === entryId) ?? null,
    [directory.entries, entryId],
  );
  const holders = useMemo(
    () => (entry ? librariesHoldingEntry(directory, entry.id, hi) : []),
    [directory, entry, hi],
  );

  if (isLoading && !entry) {
    return (
      <Screen>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }

  if (!entry) {
    return (
      <Screen>
        <StateView
          status="empty"
          emptyText={
            hi
              ? "यह ग्रंथ नहीं मिला — हो सकता है इसे सूची से हटा दिया गया हो।"
              : "That granth could not be found — it may have been removed from the directory."
          }
        />
      </Screen>
    );
  }

  const title = entryTitle(entry, hi);
  const author = entryAuthor(entry, hi);
  const description = pickText(hi, entry.description_en, entry.description_hi);

  return (
    <Screen>
      <Title style={{ fontSize: 22, lineHeight: 30 }}>{title}</Title>
      {author || entry.language ? (
        <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 22 }}>
          {[author, entry.language].filter(Boolean).join(" · ")}
        </Body>
      ) : null}

      {description ? (
        <Card style={{ marginTop: 16 }}>
          <Body style={{ fontSize: 14, lineHeight: 24 }}>{description}</Body>
        </Card>
      ) : null}

      {entry.linked_item_id ? (
        <View style={{ marginTop: 16 }}>
          <Button
            label={hi ? "ऑनलाइन पढ़ें" : "Read online"}
            icon="book-outline"
            onPress={() =>
              router.push(`/library/item/${entry.linked_item_id}` as Href)
            }
          />
        </View>
      ) : null}

      <Title style={{ fontSize: 16, lineHeight: 24, marginTop: 20, marginBottom: 8 }}>
        {hi ? "यहाँ उपलब्ध है" : "Available at"}
      </Title>

      {holders.length === 0 ? (
        <StateView
          status="empty"
          emptyText={
            hi
              ? "किसी सूचीबद्ध पुस्तकालय में यह ग्रंथ दर्ज नहीं है।"
              : "No listed library has recorded a copy of this granth."
          }
        />
      ) : (
        holders.map(({ library, note }) => (
          <Pressable
            key={library.id}
            onPress={() =>
              router.push(
                `/library/granth/library/${library.id}?sectionId=${sectionId}` as Href,
              )
            }
            accessibilityRole="button"
            accessibilityLabel={libraryName(library, hi)}
          >
            <Card>
              <Row style={{ gap: 10, alignItems: "flex-start" }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Title style={{ fontSize: 15, lineHeight: 22 }}>
                    {libraryName(library, hi)}
                  </Title>
                  <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 22 }}>
                    {library.city_name}
                  </Body>
                  {note ? (
                    <Body muted style={{ marginTop: 2, fontSize: 13, lineHeight: 22 }}>
                      {note}
                    </Body>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
              </Row>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
