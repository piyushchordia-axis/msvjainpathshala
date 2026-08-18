import { ActivityIndicator, Alert, Pressable, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { LibraryItemDto } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  resolveAudioButtonState,
  useLibraryDownload,
} from "@/contexts/LibraryDownloadContext";
import { Body } from "@/components/ui";
import { formatBytes } from "@/lib/library/downloaded-audio";

/** Confirm before downloading when size is known and at least this large. */
const LARGE_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Per-item Save offline / Cancel / Retry / Remove for library audio.
 */
export function LibraryOfflineButton({
  item,
  style,
  compact = false,
}: {
  item: LibraryItemDto;
  style?: StyleProp<ViewStyle>;
  /** Icon-only (e.g. full player). */
  compact?: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const { getRow, getProgress, enqueue, cancel, retry, remove } = useLibraryDownload();
  const row = getRow(item.id);
  const state = resolveAudioButtonState(row, item.content_version);
  const progress = getProgress(item.id);

  const label =
    state === "ready"
      ? hi
        ? "डाउनलोड हुआ"
        : "Downloaded"
      : state === "queued" || state === "downloading"
        ? hi
          ? "रद्द"
          : "Cancel"
        : state === "failed"
          ? hi
            ? "पुनः"
            : "Retry"
          : hi
            ? "डाउनलोड"
            : "Download";

  const a11y =
    state === "ready"
      ? hi
        ? "ऑफ़लाइन हटाएँ"
        : "Remove offline"
      : state === "queued" || state === "downloading"
        ? hi
          ? "डाउनलोड रद्द करें"
          : "Cancel download"
        : state === "failed"
          ? hi
            ? "फिर से डाउनलोड करें"
            : "Retry download"
          : hi
            ? "डाउनलोड"
            : "Download";

  function startDownload() {
    const size = item.audio_size_bytes;
    if (typeof size === "number" && size >= LARGE_DOWNLOAD_BYTES) {
      Alert.alert(
        hi ? "ऑफ़लाइन सेव करें?" : "Save offline?",
        hi
          ? `यह फ़ाइल लगभग ${formatBytes(size)} है। डाउनलोड करें?`
          : `This file is about ${formatBytes(size)}. Download it?`,
        [
          { text: hi ? "रद्द" : "Cancel", style: "cancel" },
          { text: hi ? "डाउनलोड" : "Download", onPress: () => void enqueue(item) },
        ],
      );
      return;
    }
    void enqueue(item);
  }

  function onPress() {
    if (state === "queued" || state === "downloading") {
      void cancel(item.id);
      return;
    }
    if (state === "failed") {
      void retry(item.id);
      return;
    }
    if (state === "ready") {
      Alert.alert(
        hi ? "ऑफ़लाइन हटाएँ?" : "Remove offline copy?",
        hi
          ? "डिवाइस से यह ऑडियो हट जाएगा। आप फिर से डाउनलोड कर सकते हैं।"
          : "This removes the audio from this device. You can download it again later.",
        [
          { text: hi ? "रद्द" : "Cancel", style: "cancel" },
          {
            text: hi ? "हटाएँ" : "Remove",
            style: "destructive",
            onPress: () => void remove(item.id),
          },
        ],
      );
      return;
    }
    startDownload();
  }

  const iconName =
    state === "ready"
      ? "checkmark-circle"
      : state === "failed"
        ? "refresh-outline"
        : "download-outline";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[
        {
          flexDirection: compact ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: compact ? 2 : 6,
          paddingHorizontal: compact ? 6 : 8,
          paddingVertical: 6,
          minHeight: 44,
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
        <ActivityIndicator size="small" color={c.primary} />
      ) : (
        <Ionicons
          name={iconName}
          size={compact ? 20 : 16}
          color={state === "ready" ? c.secondary : c.foreground}
        />
      )}
      {/* A 2px sliver under an 18px spinner was the only progress a reader
          got. The percentage sits where the label does, so a download that is
          moving looks different from one that has stalled. */}
      <Body
        numberOfLines={1}
        style={{
          fontSize: compact ? 11 : 13,
          lineHeight: compact ? 14 : 18,
          color: c.secondary,
          flexShrink: 1,
        }}
      >
        {state === "downloading" && progress > 0 ? `${Math.round(progress * 100)}%` : label}
      </Body>
    </Pressable>
  );
}
