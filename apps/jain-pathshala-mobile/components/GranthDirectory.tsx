import { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, Card, Row, StateView, Title } from "@/components/ui";
import {
  type GranthBrowseMode,
  type GranthDirectoryDto,
  cityOptions,
  entryAuthor,
  entryTitle,
  filterToLibraries,
  groupLibrariesByCity,
  libraryAddress,
  libraryName,
  searchEntries,
} from "@/lib/library/granth-directory";

export type GranthDirectoryProps = {
  sectionId: string;
  directory: GranthDirectoryDto;
  /** §17.11.4 — the viewer's own city, when the session knows one. */
  viewerCityId: string | null;
  /** Cross-link filter: only these libraries, when arriving from an item. */
  filterLibraryIds: string[] | null;
  onClearFilter: () => void;
  loading?: boolean;
};

/**
 * v3 §17.11.3–17.11.4 — the Offline Granth directory.
 *
 * Two toggleable browse modes over one cached payload. Not content: this is a
 * directory of physical places, so nothing here downloads, and every action
 * ends in another app on the device.
 */
export function GranthDirectory({
  sectionId,
  directory,
  viewerCityId,
  filterLibraryIds,
  onClearFilter,
  loading,
}: GranthDirectoryProps) {
  const c = useColors();
  const { hi } = useLocale();
  const [mode, setMode] = useState<GranthBrowseMode>("library");
  const [query, setQuery] = useState("");

  const visibleLibraries = useMemo(
    () => filterToLibraries(directory.libraries, filterLibraryIds),
    [directory.libraries, filterLibraryIds],
  );

  const cities = useMemo(() => cityOptions(visibleLibraries), [visibleLibraries]);

  // Default to the viewer's city, but only once we know it holds something —
  // resolved lazily so a directory that loads after first paint still applies it.
  const [cityChoice, setCityChoice] = useState<string | null | undefined>(undefined);
  const activeCity =
    cityChoice === undefined
      ? viewerCityId && visibleLibraries.some((l) => l.city_id === viewerCityId)
        ? viewerCityId
        : null
      : cityChoice;

  const groups = useMemo(
    () => groupLibrariesByCity(visibleLibraries, hi, activeCity),
    [visibleLibraries, hi, activeCity],
  );

  const entries = useMemo(
    () => searchEntries(directory.entries, query, hi),
    [directory.entries, query, hi],
  );

  if (loading && directory.libraries.length === 0 && directory.entries.length === 0) {
    return <StateView status="loading" emptyText="" />;
  }

  return (
    <View style={{ gap: 12 }}>
      <Row style={{ gap: 8 }}>
        {(
          [
            { id: "library" as const, label: hi ? "पुस्तकालय अनुसार" : "By library" },
            { id: "granth" as const, label: hi ? "ग्रंथ अनुसार" : "By granth" },
          ]
        ).map((m) => {
          const active = m.id === mode;
          return (
            <Pressable
              key={m.id}
              onPress={() => setMode(m.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={m.label}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? c.primary : c.border,
                backgroundColor: active ? c.accent : c.card,
              }}
            >
              <Body
                numberOfLines={1}
                style={{
                  fontSize: 14,
                  lineHeight: 22,
                  color: active ? c.primary : c.mutedForeground,
                }}
              >
                {m.label}
              </Body>
            </Pressable>
          );
        })}
      </Row>

      {filterLibraryIds && filterLibraryIds.length > 0 ? (
        <Pressable
          onPress={onClearFilter}
          accessibilityRole="button"
          accessibilityLabel={hi ? "फ़िल्टर हटाएँ" : "Clear filter"}
        >
          <Card style={{ borderColor: c.primary }}>
            <Row style={{ alignItems: "center", gap: 8 }}>
              <Ionicons name="funnel-outline" size={16} color={c.primary} />
              <Body style={{ flex: 1, fontSize: 13, lineHeight: 22, color: c.primary }}>
                {hi
                  ? "इस ग्रंथ को रखने वाले पुस्तकालय दिखाए जा रहे हैं"
                  : "Showing only libraries that hold this granth"}
              </Body>
              <Ionicons name="close-circle" size={18} color={c.primary} />
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {mode === "library" ? (
        <>
          {/* §17.11.4 — cities come from the published rows, so the filter can
              never offer a city with nothing behind it. */}
          {cities.length > 1 ? (
            <Row style={{ flexWrap: "wrap", gap: 8 }}>
              <CityChip
                label={hi ? "सभी शहर" : "All cities"}
                active={activeCity === null}
                onPress={() => setCityChoice(null)}
              />
              {cities.map((city) => (
                <CityChip
                  key={city.id}
                  label={`${city.name} (${city.count})`}
                  active={activeCity === city.id}
                  onPress={() => setCityChoice(city.id)}
                />
              ))}
            </Row>
          ) : null}

          {groups.length === 0 ? (
            <StateView
              status="empty"
              emptyText={
                hi
                  ? "अभी कोई ग्रंथ पुस्तकालय सूचीबद्ध नहीं है।"
                  : "No granth libraries are listed yet."
              }
            />
          ) : (
            groups.map((group) => (
              <View key={group.cityId} style={{ gap: 8 }}>
                <Title style={{ fontSize: 14, lineHeight: 22, color: c.mutedForeground }}>
                  {group.cityName}
                </Title>
                {group.libraries.map((lib) => (
                  <Pressable
                    key={lib.id}
                    onPress={() =>
                      router.push(
                        `/library/granth/library/${lib.id}?sectionId=${sectionId}` as Href,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={libraryName(lib, hi)}
                  >
                    <Card>
                      <Row style={{ gap: 10, alignItems: "flex-start" }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Title style={{ fontSize: 15, lineHeight: 22 }}>
                            {libraryName(lib, hi)}
                          </Title>
                          <Body
                            muted
                            numberOfLines={2}
                            style={{ marginTop: 4, fontSize: 13, lineHeight: 22 }}
                          >
                            {libraryAddress(lib, hi)}
                          </Body>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={c.mutedForeground}
                        />
                      </Row>
                    </Card>
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </>
      ) : (
        <>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: c.card,
              borderRadius: c.radius,
              borderWidth: 1,
              borderColor: c.border,
              paddingHorizontal: 12,
              minHeight: 44,
            }}
          >
            <Ionicons name="search-outline" size={20} color={c.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={hi ? "ग्रंथ खोजें…" : "Search granths…"}
              placeholderTextColor={c.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel={hi ? "ग्रंथ खोज" : "Granth search"}
              style={{
                flex: 1,
                fontSize: 16,
                lineHeight: 22,
                color: c.foreground,
                paddingVertical: 10,
              }}
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={hi ? "साफ़ करें" : "Clear"}
              >
                <Ionicons name="close-circle" size={20} color={c.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          {entries.length === 0 ? (
            <StateView
              status="empty"
              emptyText={
                query
                  ? hi
                    ? "कोई ग्रंथ नहीं मिला।"
                    : "No matching granths."
                  : hi
                    ? "अभी कोई ग्रंथ सूचीबद्ध नहीं है।"
                    : "No granths are listed yet."
              }
            />
          ) : (
            entries.map((entry) => {
              const author = entryAuthor(entry, hi);
              return (
                <Pressable
                  key={entry.id}
                  onPress={() =>
                    router.push(
                      `/library/granth/entry/${entry.id}?sectionId=${sectionId}` as Href,
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={entryTitle(entry, hi)}
                >
                  <Card>
                    <Row style={{ gap: 10, alignItems: "flex-start" }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Title style={{ fontSize: 15, lineHeight: 22 }}>
                          {entryTitle(entry, hi)}
                        </Title>
                        {author || entry.language ? (
                          <Body
                            muted
                            numberOfLines={1}
                            style={{ marginTop: 4, fontSize: 13, lineHeight: 22 }}
                          >
                            {[author, entry.language].filter(Boolean).join(" · ")}
                          </Body>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
                    </Row>
                  </Card>
                </Pressable>
              );
            })
          )}
        </>
      )}
    </View>
  );
}

function CityChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? c.primary : c.border,
        backgroundColor: active ? c.accent : c.card,
      }}
    >
      <Body
        style={{
          fontSize: 13,
          lineHeight: 18,
          color: active ? c.primary : c.mutedForeground,
        }}
      >
        {label}
      </Body>
    </Pressable>
  );
}
