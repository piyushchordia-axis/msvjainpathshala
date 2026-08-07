/**
 * Shared niyam proof thumb + pinch-zoom image viewer.
 * Used by reviewer queues and the parent's own submission list.
 */
import { useEffect } from "react";
import { Linking, Modal, Pressable, Text, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";

export type NiyamProofKind = "photo" | "video" | "audio";

export type NiyamProofMedia = {
  id?: string;
  url?: string | null;
  kind?: string | null;
};

/** Prefer a photo thumb; else video/audio URL for system-player open + kind icon. */
export function firstProofPreview(row: {
  media?: NiyamProofMedia[] | null;
  proof_url?: string | null;
}): { uri: string | null; kind: NiyamProofKind | null } {
  const media = row.media ?? [];
  const photo = media.find((m) => m.kind === "photo" && m.url)?.url;
  if (photo) return { uri: photo, kind: "photo" };
  if (row.proof_url) return { uri: row.proof_url, kind: "photo" };
  const video = media.find((m) => m.kind === "video" && m.url)?.url;
  if (video) return { uri: video, kind: "video" };
  const audio = media.find((m) => m.kind === "audio" && m.url)?.url;
  if (audio) return { uri: audio, kind: "audio" };
  return { uri: null, kind: null };
}

export async function openProofExternally(uri: string): Promise<void> {
  try {
    await Linking.openURL(uri);
  } catch {
    // System player / browser unavailable — caller may surface an alert.
  }
}

function kindIcon(kind: NiyamProofKind | null): keyof typeof Ionicons.glyphMap {
  if (kind === "video") return "videocam-outline";
  if (kind === "audio") return "musical-notes-outline";
  return "image-outline";
}

export function ProofThumb({
  uri,
  kind = null,
  size = 56,
  onPress,
}: {
  uri: string | null;
  kind?: NiyamProofKind | null;
  size?: number;
  onPress: () => void;
}) {
  const c = useColors();
  const showImage = kind === "photo" && !!uri;
  return (
    <Pressable
      onPress={onPress}
      disabled={!uri && !kind}
      style={{
        width: size,
        height: size,
        borderRadius: c.radius,
        overflow: "hidden",
        backgroundColor: c.muted,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {showImage ? (
        <ExpoImage source={{ uri: uri! }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <Ionicons name={kindIcon(kind)} size={Math.round(size * 0.4)} color={c.mutedForeground} />
      )}
    </Pressable>
  );
}

export function ImageViewerModal({
  uri,
  open,
  onClose,
}: {
  uri: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  useEffect(() => {
    if (open) {
      scale.value = 1;
      savedScale.value = 1;
    }
  }, [open, scale, savedScale]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(4, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Modal visible={open && !!uri} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.foreground }}>
        <Pressable
          onPress={onClose}
          style={{ position: "absolute", top: 48, right: 20, zIndex: 2, padding: 8 }}
        >
          <Text style={{ color: c.cream, fontSize: 16, fontFamily: bodyFamily(hi, "semibold") }}>
            {hi ? "बंद करें" : "Close"}
          </Text>
        </Pressable>
        {uri ? (
          <GestureDetector gesture={pinch}>
            <Animated.View style={[{ flex: 1, justifyContent: "center" }, animStyle]}>
              <ExpoImage source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="contain" />
            </Animated.View>
          </GestureDetector>
        ) : null}
      </View>
    </Modal>
  );
}
