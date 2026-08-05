import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

type MergedPalette = typeof colors.light & { radius: typeof colors.radius };

/** Module-scoped caches — avoids a fresh merged object on every useColors call. */
let lightCache: MergedPalette | null = null;
let darkCache: MergedPalette | null = null;

function getLightPalette(): MergedPalette {
  if (!lightCache) lightCache = { ...colors.light, radius: colors.radius };
  return lightCache;
}

function getDarkPalette(): MergedPalette {
  if (!darkCache) {
    darkCache = {
      ...(colors as Record<string, typeof colors.light>).dark,
      radius: colors.radius,
    };
  }
  return darkCache;
}

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * Falls back to the light palette when no dark key is defined in
 * constants/colors.ts (the scaffold ships light-only by default).
 * When a sibling web artifact's dark tokens are synced into a `dark`
 * key, this hook will automatically switch palettes based on the
 * device's appearance setting.
 */
export function useColors(): MergedPalette {
  const scheme = useColorScheme();
  if (scheme === "dark" && "dark" in colors) return getDarkPalette();
  return getLightPalette();
}
