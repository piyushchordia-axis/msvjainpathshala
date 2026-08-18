import { useMemo } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, Card, Row, Screen, StateView, Title } from "@/components/ui";
import { fetchGranthDirectory, granthDirectoryKey } from "@/lib/library/granth";
import {
  EMPTY_DIRECTORY,
  entriesAtLibrary,
  entryTitle,
  libraryAddress,
  libraryName,
  pickText,
} from "@/lib/library/granth-directory";
import { openMaps, openPhone, openWhatsapp, whatsappUrl } from "@/lib/library/granth-links";

/**
 * v3 §17.11.4 — one physical library.
 *
 * Every action here ends in another app: maps, dialler, WhatsApp. None of them
 * is rendered when the data behind it is missing, because a button that cannot
 * work reads as a broken app rather than as an absent phone number.
 */
export default function GranthLibraryDetail() {
  const { libraryId: rawId, sectionId: rawSection } = useLocalSearchParams<{
    libraryId: string;
    sectionId?: string | string[];
  }>();
  const libraryId = String(rawId ?? "");
  const sectionId = String(Array.isArray(rawSection) ? rawSection[0] : (rawSection ?? ""));
  const c = useColors();
  const { hi } = useLocale();

  const { data, isLoading } = useQuery({
    queryKey: granthDirectoryKey(sectionId),
    queryFn: () => fetchGranthDirectory(sectionId),
    enabled: !!sectionId,
  });
  const directory = data ?? EMPTY_DIRECTORY;

  const library = useMemo(
    () => directory.libraries.find((l) => l.id === libraryId) ?? null,
    [directory.libraries, libraryId],
  );
  const catalogue = useMemo(
    () => (library ? entriesAtLibrary(directory, library.id, hi) : []),
    [directory, library, hi],
  );

  function handoffFailed(what: "maps" | "phone" | "whatsapp") {
    const copy = {
      maps: hi
        ? "कोई नक्शा ऐप नहीं मिला — Google Maps इंस्टॉल करें, या नीचे दिया पता स्वयं खोजें।"
        : "No maps app could open this — install Google Maps, or search the address below yourself.",
      phone: hi
        ? "इस डिवाइस पर कॉल नहीं हो सकी — नंबर कॉपी करके किसी फ़ोन से मिलाएँ।"
        : "This device could not place the call — copy the number and dial it from a phone.",
      whatsapp: hi
        ? "WhatsApp नहीं खुला — WhatsApp इंस्टॉल करें, या इसी नंबर पर कॉल करें।"
        : "WhatsApp could not open — install WhatsApp, or call the same number instead.",
    }[what];
    Alert.alert(hi ? "यह क्रिया पूरी नहीं हुई" : "That could not be opened", copy);
  }

  if (isLoading && !library) {
    return (
      <Screen>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }

  if (!library) {
    return (
      <Screen>
        <StateView
          status="empty"
          emptyText={
            hi
              ? "यह पुस्तकालय नहीं मिला — हो सकता है इसे सूची से हटा दिया गया हो।"
              : "That library could not be found — it may have been removed from the directory."
          }
        />
      </Screen>
    );
  }

  const name = libraryName(library, hi);
  const address = libraryAddress(library, hi);
  const timings = pickText(hi, library.timings_en, library.timings_hi);
  const note = pickText(hi, library.note_en, library.note_hi);
  // has_whatsapp is the admin's claim; a number wa.me cannot address is the
  // data's answer. Both must agree before the button appears.
  const showWhatsapp = library.has_whatsapp && !!whatsappUrl(library.contact_phone);

  return (
    <Screen>
      <Title style={{ fontSize: 22, lineHeight: 30 }}>{name}</Title>
      <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 22 }}>
        {library.city_name}
      </Body>

      <Card style={{ marginTop: 16 }}>
        <ActionRow
          icon="location-outline"
          label={address}
          hint={hi ? "नक्शे में खोलें" : "Open in maps"}
          onPress={async () => {
            if ((await openMaps(library, name, address)) === "failed") handoffFailed("maps");
          }}
        />
        {library.contact_name ? (
          <Row style={{ gap: 10, alignItems: "center", paddingVertical: 10 }}>
            <Ionicons name="person-outline" size={18} color={c.mutedForeground} />
            <Body style={{ flex: 1, fontSize: 14, lineHeight: 22 }}>
              {library.contact_name}
            </Body>
          </Row>
        ) : null}
        {library.contact_phone ? (
          <ActionRow
            icon="call-outline"
            label={library.contact_phone}
            hint={hi ? "कॉल करें" : "Tap to call"}
            onPress={async () => {
              if ((await openPhone(library.contact_phone)) === "failed") {
                handoffFailed("phone");
              }
            }}
          />
        ) : null}
        {showWhatsapp ? (
          <ActionRow
            icon="logo-whatsapp"
            label="WhatsApp"
            hint={hi ? "संदेश भेजें" : "Send a message"}
            onPress={async () => {
              if ((await openWhatsapp(library.contact_phone)) === "failed") {
                handoffFailed("whatsapp");
              }
            }}
          />
        ) : null}
        {timings ? (
          <Row style={{ gap: 10, alignItems: "center", paddingVertical: 10 }}>
            <Ionicons name="time-outline" size={18} color={c.mutedForeground} />
            <Body style={{ flex: 1, fontSize: 14, lineHeight: 22 }}>{timings}</Body>
          </Row>
        ) : null}
      </Card>

      {note ? (
        <Card style={{ marginTop: 12 }}>
          <Body muted style={{ fontSize: 13, lineHeight: 22 }}>
            {note}
          </Body>
        </Card>
      ) : null}

      <Title style={{ fontSize: 16, lineHeight: 24, marginTop: 20, marginBottom: 8 }}>
        {hi ? "यहाँ उपलब्ध ग्रंथ" : "Granths held here"}
      </Title>

      {catalogue.length === 0 ? (
        <StateView
          status="empty"
          emptyText={
            hi
              ? "इस पुस्तकालय की ग्रंथ सूची अभी दर्ज नहीं है।"
              : "This library's granth catalogue has not been listed yet."
          }
        />
      ) : (
        catalogue.map(({ entry, note: rowNote }) => (
          <Pressable
            key={entry.id}
            onPress={() =>
              router.push(`/library/granth/entry/${entry.id}?sectionId=${sectionId}` as Href)
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
                  {/* The per-row note is what stops a wasted trip: "reference
                      only, not for issue" belongs against THIS shelf copy. */}
                  {rowNote ? (
                    <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 22 }}>
                      {rowNote}
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

function ActionRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${hint}: ${label}`}
      style={{ paddingVertical: 10 }}
    >
      <Row style={{ gap: 10, alignItems: "center" }}>
        <Ionicons name={icon} size={18} color={c.primary} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body style={{ fontSize: 14, lineHeight: 22, color: c.primary }}>{label}</Body>
          <Body muted style={{ fontSize: 12, lineHeight: 18 }}>
            {hint}
          </Body>
        </View>
        <Ionicons name="open-outline" size={16} color={c.mutedForeground} />
      </Row>
    </Pressable>
  );
}
