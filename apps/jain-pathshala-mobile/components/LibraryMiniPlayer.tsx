import { Pressable, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { bodyFamily } from "@/constants/typography";
import { useLocale } from "@/contexts/LocaleContext";
import {
  useLibraryAudio,
  SPEEDS,
  type PlaybackSpeed,
} from "@/contexts/LibraryAudioContext";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Compact bar above the tab bar when a library track is loaded.
 */
export function LibraryMiniPlayer({ bottomOffset = 56 }: { bottomOffset?: number }) {
  const c = useColors();
  const { hi } = useLocale();
  const {
    loaded,
    track,
    playing,
    position,
    duration,
    togglePlayPause,
    setFullPlayerOpen,
    stop,
  } = useLibraryAudio();

  if (!loaded || !track) return null;

  const title = hi
    ? track.title_hi || track.title_en || track.title_gu
    : track.title_en || track.title_hi || track.title_gu;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <Pressable
      onPress={() => setFullPlayerOpen(true)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: bottomOffset,
        zIndex: 40,
        backgroundColor: c.card,
        borderTopWidth: 1,
        borderTopColor: c.border,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
      accessibilityRole="button"
      accessibilityLabel={hi ? "ऑडियो प्लेयर खोलें" : "Open audio player"}
    >
      <View
        style={{
          height: 3,
          backgroundColor: c.muted,
          borderRadius: 2,
          marginBottom: 8,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: 3,
            width: `${progress * 100}%`,
            backgroundColor: c.primary,
          }}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            togglePlayPause();
          }}
          hitSlop={8}
          accessibilityLabel={playing ? (hi ? "रोकें" : "Pause") : hi ? "चलाएँ" : "Play"}
        >
          <Ionicons
            name={playing ? "pause-circle" : "play-circle"}
            size={36}
            color={c.primary}
          />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: bodyFamily(hi, "semibold"),
              fontSize: 14,
              color: c.foreground,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 12,
              color: c.mutedForeground,
              marginTop: 2,
            }}
          >
            {formatTime(position)} / {formatTime(duration)}
          </Text>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            stop();
          }}
          hitSlop={10}
          accessibilityLabel={hi ? "बंद करें" : "Close"}
        >
          <Ionicons name="close" size={22} color={c.mutedForeground} />
        </Pressable>
      </View>
    </Pressable>
  );
}

/**
 * Expanded library audio player (modal overlay).
 */
export function LibraryFullPlayer() {
  const c = useColors();
  const { hi } = useLocale();
  const {
    loaded,
    track,
    playing,
    position,
    duration,
    rate,
    fullPlayerOpen,
    togglePlayPause,
    seekTo,
    setSpeed,
    stop,
  } = useLibraryAudio();

  if (!fullPlayerOpen || !loaded || !track) return null;

  const title = hi
    ? track.title_hi || track.title_en || track.title_gu
    : track.title_en || track.title_hi || track.title_gu;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  function dismissPlayer() {
    stop();
  }

  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 60,
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "flex-end",
      }}
    >
      <Pressable style={{ flex: 1 }} onPress={dismissPlayer} />
      <View
        style={{
          backgroundColor: c.card,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 36,
          gap: 16,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text
            style={{
              fontFamily: bodyFamily(hi, "semibold"),
              fontSize: 18,
              color: c.secondary,
              flex: 1,
              paddingRight: 12,
            }}
            numberOfLines={2}
          >
            {title}
          </Text>
          <Pressable onPress={dismissPlayer} hitSlop={10} accessibilityLabel={hi ? "बंद करें" : "Close"}>
            <Ionicons name="close" size={24} color={c.mutedForeground} />
          </Pressable>
        </View>

        <SeekBar
          progress={progress}
          onSeek={(pct) => void seekTo(pct * (duration || 0))}
          trackColor={c.muted}
          fillColor={c.primary}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontFamily: bodyFamily(hi), fontSize: 12, color: c.mutedForeground }}>
            {formatTime(position)}
          </Text>
          <Text style={{ fontFamily: bodyFamily(hi), fontSize: 12, color: c.mutedForeground }}>
            {formatTime(duration)}
          </Text>
        </View>

        <View style={{ alignItems: "center" }}>
          <Pressable onPress={togglePlayPause} hitSlop={12}>
            <Ionicons
              name={playing ? "pause-circle" : "play-circle"}
              size={64}
              color={c.primary}
            />
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
          {SPEEDS.map((s) => (
            <SpeedChip
              key={s}
              speed={s}
              active={rate === s}
              onPress={() => setSpeed(s)}
              hi={hi}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function SpeedChip({
  speed,
  active,
  onPress,
  hi,
}: {
  speed: PlaybackSpeed;
  active: boolean;
  onPress: () => void;
  hi: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: active ? c.primary : c.border,
        backgroundColor: active ? c.accent : "transparent",
      }}
    >
      <Text
        style={{
          fontFamily: bodyFamily(hi, "medium"),
          fontSize: 13,
          color: active ? c.primary : c.foreground,
        }}
      >
        {speed}×
      </Text>
    </Pressable>
  );
}

function SeekBar({
  progress,
  onSeek,
  trackColor,
  fillColor,
}: {
  progress: number;
  onSeek: (pct: number) => void;
  trackColor: string;
  fillColor: string;
}) {
  const widthRef = { current: 1 };
  return (
    <Pressable
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width || 1;
      }}
      onPress={(e) => {
        const pct = Math.min(1, Math.max(0, e.nativeEvent.locationX / widthRef.current));
        onSeek(pct);
      }}
      style={{ height: 28, justifyContent: "center" }}
    >
      <View style={{ height: 4, backgroundColor: trackColor, borderRadius: 2, overflow: "hidden" }}>
        <View
          style={{
            height: 4,
            width: `${Math.min(100, progress * 100)}%`,
            backgroundColor: fillColor,
          }}
        />
      </View>
    </Pressable>
  );
}
