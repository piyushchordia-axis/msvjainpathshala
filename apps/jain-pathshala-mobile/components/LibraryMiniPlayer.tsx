import { useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Pressable, View, Text } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import type { LibraryItemDto } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { bodyFamily } from "@/constants/typography";
import { useLocale } from "@/contexts/LocaleContext";
import {
  useLibraryAudio,
  SPEEDS,
  type PlaybackSpeed,
} from "@/contexts/LibraryAudioContext";
import { findItemInTrees, libraryTreesFromCache } from "@/lib/library/helpers";
import { useTabBarInset } from "@/contexts/TabBarInsetContext";
import { LibraryOfflineButton } from "@/components/LibraryOfflineButton";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Compact bar above the tab bar when a library track is loaded.
 *
 * The offset used to be a fixed 64 passed at the single root mount — right on
 * the tabbed home screens and wrong everywhere else, because a pushed screen
 * (a library section, Downloads, a Panchang day) has no tab bar. There the bar
 * floated 64px up with a strip of background showing beneath it, and still
 * covered the last row of any list that had not padded for it.
 *
 * `bottomOffset` is now a floor, not the answer: the live tab-bar height wins
 * when there is one. See contexts/TabBarInsetContext.
 */
export function LibraryMiniPlayer({ bottomOffset = 0 }: { bottomOffset?: number }) {
  const c = useColors();
  const { hi } = useLocale();
  const tabBarInset = useTabBarInset();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(bottomOffset, tabBarInset || insets.bottom);
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
  const isLocal = track.source === "local";

  return (
    <Pressable
      onPress={() => setFullPlayerOpen(true)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 14,
                color: c.foreground,
                flexShrink: 1,
              }}
            >
              {title}
            </Text>
            {isLocal ? (
              <Ionicons name="cloud-done" size={14} color={c.primary} />
            ) : null}
          </View>
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
  const qc = useQueryClient();
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
    skipBy,
    setSpeed,
    stop,
    setFullPlayerOpen,
  } = useLibraryAudio();

  const currentItem = useMemo((): LibraryItemDto | null => {
    if (!track) return null;
    return findItemInTrees(libraryTreesFromCache(qc), track.itemId)?.item ?? null;
  }, [qc, track]);

  if (!fullPlayerOpen || !loaded || !track) return null;

  const title = hi
    ? track.title_hi || track.title_en || track.title_gu
    : track.title_en || track.title_hi || track.title_gu;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const isLocal = track.source === "local";

  function collapse() {
    setFullPlayerOpen(false);
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
      <Pressable
        style={{ flex: 1 }}
        onPress={collapse}
        accessibilityLabel={hi ? "छोटा करें" : "Collapse"}
      />
      <View
        style={{
          backgroundColor: c.card,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 36,
          gap: 14,
        }}
      >
        <View style={{ alignItems: "center", marginBottom: 4 }}>
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: c.border,
            }}
          />
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Pressable
            onPress={collapse}
            hitSlop={10}
            accessibilityLabel={hi ? "छोटा करें" : "Collapse"}
            style={{ paddingRight: 8, paddingTop: 2 }}
          >
            <Ionicons name="chevron-down" size={26} color={c.mutedForeground} />
          </Pressable>
          <View style={{ flex: 1, paddingHorizontal: 4 }}>
            <Text
              style={{
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 18,
                lineHeight: 26,
                color: c.secondary,
                textAlign: "center",
              }}
              numberOfLines={2}
            >
              {title}
            </Text>
            {isLocal ? (
              <View
                style={{
                  marginTop: 8,
                  alignSelf: "center",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 8,
                  backgroundColor: c.accent,
                }}
              >
                <Ionicons name="cloud-done" size={14} color={c.primary} />
                <Text
                  style={{
                    fontFamily: bodyFamily(hi, "medium"),
                    fontSize: 12,
                    color: c.primary,
                  }}
                >
                  {hi ? "डिवाइस पर सेव" : "Saved on device"}
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable onPress={stop} hitSlop={10} accessibilityLabel={hi ? "बंद करें" : "Close"}>
            <Ionicons name="close" size={24} color={c.mutedForeground} />
          </Pressable>
        </View>

        <SeekBar
          progress={progress}
          onSeek={(pct) => void seekTo(pct * (duration || 0))}
          trackColor={c.muted}
          fillColor={c.primary}
          thumbColor={c.primary}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontFamily: bodyFamily(hi), fontSize: 12, color: c.mutedForeground }}>
            {formatTime(position)}
          </Text>
          <Text style={{ fontFamily: bodyFamily(hi), fontSize: 12, color: c.mutedForeground }}>
            {formatTime(duration)}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 28,
          }}
        >
          <Pressable
            onPress={() => void skipBy(-15)}
            hitSlop={12}
            accessibilityLabel={hi ? "15 सेकंड पीछे" : "Skip back 15 seconds"}
          >
            <Ionicons name="play-back" size={32} color={c.secondary} />
          </Pressable>
          <Pressable
            onPress={togglePlayPause}
            hitSlop={12}
            accessibilityLabel={playing ? (hi ? "रोकें" : "Pause") : hi ? "चलाएँ" : "Play"}
          >
            <Ionicons
              name={playing ? "pause-circle" : "play-circle"}
              size={72}
              color={c.primary}
            />
          </Pressable>
          <Pressable
            onPress={() => void skipBy(15)}
            hitSlop={12}
            accessibilityLabel={hi ? "15 सेकंड आगे" : "Skip forward 15 seconds"}
          >
            <Ionicons name="play-forward" size={32} color={c.secondary} />
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

        {currentItem?.audio_url ? (
          <View style={{ alignItems: "center", marginTop: 4 }}>
            <LibraryOfflineButton item={currentItem} compact style={{ minWidth: 48 }} />
          </View>
        ) : null}
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
  thumbColor,
}: {
  progress: number;
  onSeek: (pct: number) => void;
  trackColor: string;
  fillColor: string;
  thumbColor: string;
}) {
  const widthRef = useRef(1);
  const [dragging, setDragging] = useState(false);
  const [dragPct, setDragPct] = useState(0);
  const startPctRef = useRef(0);
  const dragPctRef = useRef(0);

  const shown = dragging ? dragPct : Math.min(1, Math.max(0, progress));

  const pan = Gesture.Pan()
    .onBegin(() => {
      startPctRef.current = Math.min(1, Math.max(0, progress));
      dragPctRef.current = startPctRef.current;
      setDragging(true);
      setDragPct(startPctRef.current);
    })
    .onUpdate((e) => {
      const w = widthRef.current || 1;
      const pct = Math.min(1, Math.max(0, startPctRef.current + e.translationX / w));
      dragPctRef.current = pct;
      setDragPct(pct);
    })
    .onEnd(() => {
      onSeek(dragPctRef.current);
      setDragging(false);
    })
    .onFinalize(() => {
      setDragging(false);
    })
    .runOnJS(true);

  const tap = Gesture.Tap()
    .onEnd((e) => {
      const w = widthRef.current || 1;
      const pct = Math.min(1, Math.max(0, e.x / w));
      onSeek(pct);
    })
    .runOnJS(true);

  const gesture = Gesture.Race(pan, tap);

  function onLayout(e: LayoutChangeEvent) {
    widthRef.current = e.nativeEvent.layout.width || 1;
  }

  return (
    <GestureDetector gesture={gesture}>
      <View onLayout={onLayout} style={{ height: 32, justifyContent: "center" }}>
        <View style={{ height: 4, backgroundColor: trackColor, borderRadius: 2, overflow: "hidden" }}>
          <View
            style={{
              height: 4,
              width: `${shown * 100}%`,
              backgroundColor: fillColor,
            }}
          />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: `${shown * 100}%`,
            marginLeft: -7,
            top: 9,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: thumbColor,
          }}
        />
      </View>
    </GestureDetector>
  );
}
