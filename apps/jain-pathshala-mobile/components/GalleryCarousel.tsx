import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { resolveUploadUrl } from "@/lib/api";
import {
  carouselIntervalMs,
  useClientSettings,
  useHomeGallery,
  type GalleryMediaItem,
} from "@/lib/queries";
import { Body } from "@/components/ui";

const HEIGHT = 168;

/**
 * Decorative gallery strip for post-login homes.
 * Renders nothing while loading, on error, or when the feed is empty.
 */
export function GalleryCarousel() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = Math.max(240, windowWidth - 32);

  const gallery = useHomeGallery(12);
  const settings = useClientSettings();
  const intervalMs = carouselIntervalMs(settings.data);

  const items = (gallery.data?.items ?? []).filter(
    (i): i is GalleryMediaItem & { image_url: string } => !!i.image_url,
  );

  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const listRef = useRef<FlatList<GalleryMediaItem>>(null);
  const fade = useSharedValue(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
      setReduceMotion(v);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const goTo = useCallback(
    (next: number, animate: boolean) => {
      if (items.length === 0) return;
      const wrapped = ((next % items.length) + items.length) % items.length;
      if (!reduceMotion && animate && Platform.OS !== "web") {
        fade.value = withTiming(0.35, { duration: 120 }, (finished) => {
          if (finished) {
            fade.value = withTiming(1, { duration: 220 });
          }
        });
      }
      setIndex(wrapped);
      try {
        listRef.current?.scrollToIndex({ index: wrapped, animated: animate && !reduceMotion });
      } catch {
        /* layout not ready */
      }
    },
    [fade, items.length, reduceMotion],
  );

  useEffect(() => {
    clearTimer();
    if (items.length < 2 || dragging || reduceMotion) return;
    timerRef.current = setTimeout(() => {
      goTo(index + 1, true);
    }, intervalMs);
    return clearTimer;
  }, [clearTimer, dragging, goTo, index, intervalMs, items.length, reduceMotion]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const next = Math.round(x / pageWidth);
    if (next !== index && next >= 0 && next < items.length) {
      setIndex(next);
    }
    setDragging(false);
  };

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  // Decorative: never push layout with loading / error / empty states.
  // Settings may still be loading — fall back to default interval via helper.
  if (gallery.isLoading || gallery.isError) return null;
  if (items.length === 0) return null;

  const showDots = items.length >= 2;

  return (
    <Animated.View
      style={[
        {
          borderRadius: c.radius,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.card,
        },
        fadeStyle,
      ]}
    >
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        decelerationRate="fast"
        getItemLayout={(_data, i) => ({
          length: pageWidth,
          offset: pageWidth * i,
          index: i,
        })}
        onScrollBeginDrag={() => {
          setDragging(true);
          clearTimer();
        }}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        renderItem={({ item }) => {
          const caption =
            (hi ? item.caption_hi : item.caption) || item.caption || null;
          const raw = item.thumbnail_url ?? item.image_url;
          const uri = resolveUploadUrl(raw) ?? raw;
          return (
            <Pressable
              onPress={() => router.push("/gallery")}
              style={{ width: pageWidth, height: HEIGHT }}
            >
              <Image
                source={{ uri: uri! }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
                transition={reduceMotion ? 0 : 200}
              />
              {(item.first_name || caption) ? (
                <View
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: "rgba(20,16,12,0.45)",
                  }}
                >
                  {item.first_name ? (
                    <Body style={{ color: "#fff", fontSize: 13 }} numberOfLines={1}>
                      {item.first_name}
                    </Body>
                  ) : null}
                  {caption ? (
                    <Body
                      style={{ color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 2 }}
                      numberOfLines={1}
                    >
                      {caption}
                    </Body>
                  ) : null}
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
      {showDots ? (
        <View
          style={{
            position: "absolute",
            bottom: 8,
            left: 0,
            right: 0,
            flexDirection: "row",
            justifyContent: "center",
            gap: 6,
          }}
          pointerEvents="none"
        >
          {items.map((item, i) => (
            <View
              key={item.id}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === index ? "#fff" : "rgba(255,255,255,0.45)",
              }}
            />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}
