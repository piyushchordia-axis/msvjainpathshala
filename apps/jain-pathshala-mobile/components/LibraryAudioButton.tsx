import { Alert, Pressable, type StyleProp, type ViewStyle } from "react-native";
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

function isPlayableLocalPath(path: string | null | undefined): path is string {
  if (!path) return false;
  return (
    path.endsWith(".mp3") ||
    path.endsWith(".m4a") ||
    path.endsWith(".mp4") ||
    path.endsWith(".aac")
  );
}

/**
 * Library Audio: play/pause. Prefers a ready offline `.mp3` when present;
 * otherwise streams the remote signed URL.
 */
export function LibraryAudioButton({
  item,
  style,
  compact = false,
}: {
  item: LibraryItemDto;
  style?: StyleProp<ViewStyle>;
  /** Icon-only (section item row). */
  compact?: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const { getRow } = useLibraryDownload();
  const { playItem, track, playing, togglePlayPause } = useLibraryAudio();
  const row = getRow(item.id);
  const state = resolveAudioButtonState(row, item.content_version);
  const isCurrent = track?.itemId === item.id;

  const label = isCurrent
    ? playing
      ? hi
        ? "रोकें"
        : "Pause"
      : hi
        ? "चलाएँ"
        : "Play"
    : hi
      ? "ऑडियो"
      : "Audio";

  const onPress = () => {
    if (isCurrent) {
      togglePlayPause();
      return;
    }

    // Prefer ready local file so offline playback works and saved copies are used.
    const localPath = state === "ready" ? row?.localPath : null;
    const remote = resolveUploadUrl(item.audio_url);

    let uri: string | null = null;
    let source: "local" | "remote" = "remote";
    if (isPlayableLocalPath(localPath)) {
      uri = localPath;
      source = "local";
    } else if (remote) {
      uri = remote;
      source = "remote";
    } else if (isPlayableLocalPath(row?.localPath)) {
      // Stale version or incomplete row — still try playable local as last resort.
      uri = row!.localPath;
      source = "local";
    }

    if (!uri) {
      Alert.alert(
        hi ? "ऑडियो नहीं चला" : "Could not play audio",
        hi
          ? "लिंक उपलब्ध नहीं — पेज रिफ़्रेश करके फिर कोशिश करें।"
          : "No playable link — refresh and try again.",
      );
      return;
    }
    void playItem(item, uri, source);
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
      <Ionicons
        name={isCurrent ? (playing ? "pause" : "play") : "musical-notes-outline"}
        size={compact ? 22 : 16}
        color={c.secondary}
      />
      {compact ? null : (
        <Body numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, color: c.secondary, flexShrink: 1 }}>
          {label}
        </Body>
      )}
    </Pressable>
  );
}
