import { createContext, useContext, useMemo, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import {
  ACTIVITY_ACCENT_TOKEN,
  type ActivityAccentKey,
} from "@/constants/activity-accents";
import { useColors } from "@/hooks/useColors";

export type ActivityThemeValue = {
  accent: ActivityAccentKey;
  pageBg: string;
  ink: string;
  inkStrong: string;
};

const ActivityThemeContext = createContext<ActivityThemeValue | null>(null);

export function useActivityTheme(): ActivityThemeValue | null {
  return useContext(ActivityThemeContext);
}

/** Page fill — tile pastel inside a themed section, otherwise cream. */
export function useActivityPageBg(): string {
  const c = useColors();
  return useActivityTheme()?.pageBg ?? c.background;
}

/**
 * Wraps a tile destination so Screen / AppHeader pick up the pastel page
 * background. Renders a flex fill so inner views can stay transparent.
 */
export function ActivityThemed({
  accent,
  children,
  style,
}: {
  accent: ActivityAccentKey;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const pageBg = c[ACTIVITY_ACCENT_TOKEN[accent]];
  const value = useMemo<ActivityThemeValue>(
    () => ({
      accent,
      pageBg,
      ink: c.activityInk,
      inkStrong: c.activityInkStrong,
    }),
    [accent, pageBg, c.activityInk, c.activityInkStrong],
  );
  return (
    <ActivityThemeContext.Provider value={value}>
      <View style={[{ flex: 1, backgroundColor: pageBg }, style]}>{children}</View>
    </ActivityThemeContext.Provider>
  );
}
