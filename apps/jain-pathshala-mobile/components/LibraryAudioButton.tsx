import { ActivityIndicator, Alert, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { LibraryItemDto } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  resolveAudioButtonState,
  useLibraryDownload,
} from "@/contexts/LibraryDownloadContext";
import { useLibraryAudio } from "@/contexts/LibraryAudioContext";
import { Body } from "@/components/ui";
import { resolveUploadUrl } from "@/lib/api";

/**
 * Library Audio: stream/play immediately. Offline files (from "Download all")
 * are used when remote is unavailable and the local file has a playable extension.
 */
export function LibraryAudioButton({
  item,
  style,
}: {
  item: LibraryItemDto;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const { getRow, getProgress, cancel, retry } = useLibraryDownload();
  const { playItem, track, playing, togglePlayPause } = useLibraryAudio();
  const row = getRow(item.id);
  const state = resolveAudioButtonState(row, item.content_version);
  const progress = getProgress(item.id);
  const isCurrent = track?.itemId === item.id;

  const label = isCurrent
    ? playing
      ? hi
        ? "रोकें"
        : "Pause"
      : hi
        ? "चलाएँ"
        : "Play"
    : state === "queued" || state === "downloading"
      ? hi
        ? "रद्द"
        : "Cancel"
      : state === "failed"
        ? hi
          ? "पुनः"
          : "Retry"
        : hi
          ? "ऑडियो"
          : "Audio";

  const onPress = () => {
    if (isCurrent) {
      togglePlayPause();
      return;
    }
    if (state === "queued" || state === "downloading") {
      void cancel(item.id);
      return;
    }
    if (state === "failed") {
      void retry(item.id);
      return;
    }

    // Prefer remote stream when online. Cached ".audio" downloads (legacy) and
    // incomplete offline files were opening the player with no audible output.
    const remote = resolveUploadUrl(item.audio_url);
    const localPath = state === "ready" ? row?.localPath : null;
    const localLooksPlayable =
      !!localPath &&
      (localPath.endsWith(".mp3") ||
        localPath.endsWith(".m4a") ||
        localPath.endsWith(".mp4") ||
        localPath.endsWith(".aac"));

    const uri = remote ?? (localLooksPlayable ? localPath : null);

    if (!uri) {
      Alert.alert(
        hi ? "ऑडियो नहीं चला" : "Could not play audio",
        hi
          ? "लिंक उपलब्ध नहीं — पेज रिफ़्रेश करके फिर कोशिश करें।"
          : "No playable link — refresh and try again.",
      );
      return;
    }
    void playItem(item, uri);
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingHorizontal: 8,
          paddingVertical: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: c.border,
          minWidth: 0,
        },
        style,
      ]}
    >
      {!isCurrent && (state === "downloading" || state === "queued") ? (
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
          name={
            isCurrent
              ? playing
                ? "pause"
                : "play"
              : state === "failed"
                ? "refresh-outline"
                : "play"
          }
          size={16}
          color={c.secondary}
        />
      )}
      <Body numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, color: c.secondary, flexShrink: 1 }}>
        {label}
      </Body>
    </Pressable>
  );
}
