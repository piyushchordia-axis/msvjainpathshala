import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import type { LibraryItemDto } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { stripHtml } from "@/lib/library/helpers";
import {
  availableTextLangs,
  sanitizeLibraryHtml,
  textContentForLang,
  type LibraryTextLang,
} from "@/lib/library/sanitize-html";
import {
  clampTextFontSize,
  readTextFontSize,
  TEXT_FONT_SIZE_DEFAULT,
  TEXT_FONT_SIZE_MAX,
  TEXT_FONT_SIZE_MIN,
  TEXT_FONT_SIZE_STEP,
  writeTextFontSize,
} from "@/lib/library/text-prefs";
import { LibraryHtmlBody } from "@/components/LibraryHtmlBody";
import { LibraryTarjLine } from "@/components/LibraryTarjLine";
import { Body } from "@/components/ui";

export type LibraryTextSheetProps = {
  item: LibraryItemDto | null;
  onClose: () => void;
};

function pickDefaultLang(item: LibraryItemDto, preferHi: boolean): LibraryTextLang {
  const langs = availableTextLangs(item);
  if (preferHi && langs.includes("hi")) return "hi";
  if (langs.includes("en")) return "en";
  return langs[0] ?? "en";
}

const LANG_LABEL: Record<LibraryTextLang, { en: string; hi: string }> = {
  en: { en: "EN", hi: "EN" },
  hi: { en: "HI", hi: "हि" },
  gu: { en: "GU", hi: "ગુ" },
};

/**
 * Full-screen text reader (RN Modal — reliable on iOS; BottomSheet was not presenting).
 */
export function LibraryTextSheet({ item, onClose }: LibraryTextSheetProps) {
  const c = useColors();
  const { hi } = useLocale();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [fontSize, setFontSize] = useState(TEXT_FONT_SIZE_DEFAULT);
  const [lang, setLang] = useState<LibraryTextLang>("en");
  const [copied, setCopied] = useState(false);
  const open = !!item;

  useEffect(() => {
    void readTextFontSize().then(setFontSize);
  }, []);

  useEffect(() => {
    if (!item) return;
    setLang(pickDefaultLang(item, hi));
    setCopied(false);
  }, [item, hi]);

  const langs = item ? availableTextLangs(item) : [];
  const title = item
    ? hi
      ? item.title_hi || item.title_en || item.title_gu || ""
      : item.title_en || item.title_hi || item.title_gu || ""
    : "";
  const rawHtml = item ? textContentForLang(item, lang) : "";
  const safeHtml = sanitizeLibraryHtml(rawHtml);
  const plain = stripHtml(rawHtml);
  const lineHeight = Math.round(fontSize * 1.6);

  const bumpFont = async (delta: number) => {
    const next = clampTextFontSize(fontSize + delta);
    setFontSize(next);
    await writeTextFontSize(next);
  };

  const onCopy = async () => {
    if (!plain) return;
    await Clipboard.setStringAsync(plain);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onShare = async () => {
    if (!plain) return;
    await Share.share({ message: plain, title: title || undefined });
  };

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: c.card,
          paddingTop: Math.max(insets.top, 12),
          maxHeight: height,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingBottom: 8,
            gap: 8,
          }}
        >
          <Text
            numberOfLines={2}
            style={{
              flex: 1,
              fontFamily: bodyFamily(hi, "semibold"),
              fontSize: 18,
              lineHeight: 26,
              color: c.secondary,
            }}
          >
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={hi ? "बंद करें" : "Close"}>
            <Ionicons name="close" size={26} color={c.mutedForeground} />
          </Pressable>
        </View>

        {/* §17.1.3 — the Tarj sits directly under the title, above the
            toolbar: a reader about to sing needs the melody before the
            font controls, not after them. */}
        {item ? (
          <LibraryTarjLine item={item} style={{ paddingHorizontal: 16, paddingBottom: 8 }} />
        ) : null}

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            paddingHorizontal: 16,
            paddingBottom: 8,
          }}
        >
          <ToolBtn
            icon="remove-outline"
            label={hi ? "छोटा" : "Smaller"}
            disabled={fontSize <= TEXT_FONT_SIZE_MIN}
            onPress={() => void bumpFont(-TEXT_FONT_SIZE_STEP)}
            c={c}
            hi={hi}
          />
          <ToolBtn
            icon="add-outline"
            label={hi ? "बड़ा" : "Larger"}
            disabled={fontSize >= TEXT_FONT_SIZE_MAX}
            onPress={() => void bumpFont(TEXT_FONT_SIZE_STEP)}
            c={c}
            hi={hi}
          />
          {langs.map((l) => (
            <Pressable
              key={l}
              onPress={() => setLang(l)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: lang === l ? c.primary : c.border,
                backgroundColor: lang === l ? c.accent : "transparent",
              }}
            >
              <Text
                style={{
                  fontFamily: bodyFamily(hi, "semibold"),
                  fontSize: 13,
                  color: lang === l ? c.primary : c.foreground,
                }}
              >
                {hi ? LANG_LABEL[l].hi : LANG_LABEL[l].en}
              </Text>
            </Pressable>
          ))}
          <ToolBtn
            icon={copied ? "checkmark-outline" : "copy-outline"}
            label={copied ? (hi ? "कॉपी" : "Copied") : hi ? "कॉपी" : "Copy"}
            onPress={() => void onCopy()}
            c={c}
            hi={hi}
          />
          <ToolBtn
            icon="share-outline"
            label={hi ? "शेयर" : "Share"}
            onPress={() => void onShare()}
            c={c}
            hi={hi}
          />
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 40 + insets.bottom,
          }}
        >
          {safeHtml ? (
            <LibraryHtmlBody
              html={safeHtml}
              style={{
                fontSize,
                lineHeight,
                color: c.foreground,
                fontFamily: bodyFamily(hi),
              }}
            />
          ) : (
            <Body muted>
              {hi ? "इस पाठ में सामग्री नहीं है।" : "This text has no content yet."}
            </Body>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function ToolBtn({
  icon,
  label,
  onPress,
  disabled,
  c,
  hi,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  c: ReturnType<typeof useColors>;
  hi: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: c.border,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Ionicons name={icon} size={16} color={c.secondary} />
      <Text style={{ fontFamily: bodyFamily(hi, "medium"), fontSize: 12, color: c.secondary }}>
        {label}
      </Text>
    </Pressable>
  );
}
