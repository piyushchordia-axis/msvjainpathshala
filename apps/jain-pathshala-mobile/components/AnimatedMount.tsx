import { AccessibilityInfo, Platform, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { type ReactNode, useEffect } from "react";

type Props = {
  children: ReactNode;
  /** Stagger offset in ms before the fade-rise starts. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tasteful mount animation for home-screen cards only.
 * Respects OS reduce-motion; no-ops to an instant show.
 */
export function AnimatedMount({ children, delay = 0, style }: Props) {
  const isWeb = Platform.OS === "web";
  const opacity = useSharedValue(isWeb ? 1 : 0);
  const translateY = useSharedValue(isWeb ? 0 : 10);

  useEffect(() => {
    if (isWeb) return;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (cancelled) return;
      if (enabled) {
        opacity.value = 1;
        translateY.value = 0;
        return;
      }
      opacity.value = withDelay(
        delay,
        withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }),
      );
      translateY.value = withDelay(
        delay,
        withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [delay, isWeb, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[animStyle, style]}>{children}</Animated.View>;
}
