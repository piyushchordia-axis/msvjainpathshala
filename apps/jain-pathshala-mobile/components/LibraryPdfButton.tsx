import { router } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { LibraryItemDto } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { resolvePdfButtonState, useLibraryDownload } from "@/contexts/LibraryDownloadContext";
import { Body } from "@/components/ui";
import { formatBytes } from "@/lib/library/downloaded-audio";

/** Confirm before downloading when size is known and at least this large. */
const LARGE_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * §17.1.3 — one button, four states, driven entirely by the download record:
 *
 *   not downloaded  → download icon + file size, enqueues on tap
 *   downloading     → determinate progress, cancels on tap
 *   downloaded      → opens the in-app viewer
 *   failed          → retry
 *
 * It is never rendered disabled. A greyed-out button tells a reader the app is
 * broken; a button that is absent tells them the item has no PDF, which is the
 * truth. Callers therefore mount this only when `item.pdf_url` is set.
 */
export function LibraryPdfButton({
  item,
  style,
  compact = false,
}: {
  item: LibraryItemDto;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const { getPdfRow, getPdfProgress, enqueuePdf, cancelPdf, retryPdf } = useLibraryDownload();
  const row = getPdfRow(item.id);
  const state = resolvePdfButtonState(row, item.content_version);
  const progress = getPdfProgress(item.id);
  const size = item.pdf_size_bytes ?? row?.sizeBytes ?? null;

  // Size before download (§17.4): a granth scan can be tens of megabytes and
  // the reader is often on centre wifi or a metered phone plan.
  const idleLabel = size ? formatBytes(size) : hi ? "पीडीएफ" : "PDF";

  const label =
    state === "ready"
      ? hi
        ? "पढ़ें"
        : "Read"
      : state === "queued" || state === "downloading"
        ? hi
          ? "रद्द"
          : "Cancel"
        : state === "failed"
          ? hi
            ? "पुनः"
            : "Retry"
          : idleLabel;

  const a11y =
    state === "ready"
      ? hi
        ? "पीडीएफ पढ़ें"
        : "Read PDF"
      : state === "queued" || state === "downloading"
        ? hi
          ? "पीडीएफ डाउनलोड रद्द करें"
          : "Cancel PDF download"
        : state === "failed"
          ? hi
            ? "पीडीएफ फिर से डाउनलोड करें"
            : "Retry PDF download"
          : hi
            ? `पीडीएफ डाउनलोड करें, ${idleLabel}`
            : `Download PDF, ${idleLabel}`;

  function startDownload() {
    if (typeof size === "number" && size >= LARGE_DOWNLOAD_BYTES) {
      Alert.alert(
        hi ? "पीडीएफ डाउनलोड करें?" : "Download PDF?",
        hi
          ? `यह फ़ाइल लगभग ${formatBytes(size)} है। डाउनलोड करें?`
          : `This file is about ${formatBytes(size)}. Download it?`,
        [
          { text: hi ? "रद्द" : "Cancel", style: "cancel" },
          { text: hi ? "डाउनलोड" : "Download", onPress: () => void enqueuePdf(item) },
        ],
      );
      return;
    }
    void enqueuePdf(item);
  }

  function onPress() {
    if (state === "queued" || state === "downloading") {
      void cancelPdf(item.id);
      return;
    }
    if (state === "failed") {
      void retryPdf(item.id);
      return;
    }
    if (state === "ready") {
      router.push(`/library/pdf/${item.id}` as never);
      return;
    }
    startDownload();
  }

  const iconName =
    state === "ready"
      ? "book-outline"
      : state === "failed"
        ? "refresh-outline"
        : "document-outline";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingHorizontal: compact ? 10 : 8,
          paddingVertical: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: c.border,
          minWidth: 0,
          backgroundColor: "transparent",
        },
        style,
      ]}
    >
      {state === "downloading" || state === "queued" ? (
        <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="small" color={c.primary} />
          {state === "downloading" && progress > 0 ? (
            <View
              style={{
                position: "absolute",
                bottom: -2,
                left: 0,
                right: 0,
                height: 2,
                backgroundColor: c.muted,
                borderRadius: 1,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: 2,
                  width: `${Math.round(progress * 100)}%`,
                  backgroundColor: c.primary,
                }}
              />
            </View>
          ) : null}
        </View>
      ) : (
        <Ionicons
          name={iconName}
          size={compact ? 22 : 16}
          color={state === "ready" ? c.secondary : c.foreground}
        />
      )}
      {!compact ? (
        <Body
          numberOfLines={1}
          style={{ fontSize: 13, lineHeight: 18, color: c.secondary, flexShrink: 1 }}
        >
          {label}
        </Body>
      ) : null}
    </Pressable>
  );
}
