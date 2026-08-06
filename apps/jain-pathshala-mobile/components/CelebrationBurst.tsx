import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ConfettiCannon from "react-native-confetti-cannon";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";

const BURST_MS = 2200;

type Props = {
  message?: string;
  onComplete?: () => void;
};

/**
 * Short warm confetti burst for parent/student submit success.
 * pointer-events none — never blocks taps after it starts.
 */
export function CelebrationBurst({ message, onComplete }: Props) {
  const c = useColors();
  const { hi } = useLocale();
  const [reduceMotion, setReduceMotion] = useState(false);
  const completed = useRef(false);
  const opacity = useSharedValue(0);

  const colors = [c.saffron, c.gold, c.primary, c.maroon, c.creamDark, c.secondary];
  const { width, height } = Dimensions.get("window");
  const label = message ?? (hi ? "बहुत अच्छा" : "Well done");

  const finish = () => {
    if (completed.current) return;
    completed.current = true;
    onComplete?.();
  };

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || reduceMotion) {
      opacity.value = 1;
      const t = setTimeout(finish, 900);
      return () => clearTimeout(t);
    }
    opacity.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
      withDelay(
        BURST_MS - 620,
        withTiming(0, { duration: 320, easing: Easing.in(Easing.cubic) }),
      ),
    );
    const t = setTimeout(finish, BURST_MS);
    return () => clearTimeout(t);
  }, [reduceMotion]);

  const labelStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={finish}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        {!reduceMotion && Platform.OS !== "web" ? (
          <ConfettiCannon
            count={100}
            origin={{ x: width / 2, y: -12 }}
            explosionSpeed={380}
            fallSpeed={2600}
            fadeOut
            autoStart
            colors={colors}
            onAnimationEnd={finish}
          />
        ) : null}
        <Animated.View
          style={[
            {
              position: "absolute",
              top: height * 0.28,
              left: 0,
              right: 0,
              alignItems: "center",
              paddingHorizontal: 24,
            },
            labelStyle,
          ]}
        >
          <View
            style={{
              backgroundColor: c.card,
              borderRadius: c.radius,
              borderWidth: 1,
              borderColor: c.border,
              paddingHorizontal: 18,
              paddingVertical: 10,
            }}
          >
            <Text
              style={{
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 18,
                color: c.foreground,
                textAlign: "center",
              }}
            >
              {label}
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
