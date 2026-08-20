import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

type MergedPalette = typeof colors.light & {
  radius: typeof colors.radius;
  activityTileRadius: typeof colors.activityTileRadius;
};

/** Module-scoped caches — avoids a fresh merged object on every useColors call. */
let lightCache: MergedPalette | null = null;
let darkCache: MergedPalette | null = null;

function getLightPalette(): MergedPalette {
  if (!lightCache) {
    lightCache = {
      ...colors.light,
      radius: colors.radius,
      activityTileRadius: colors.activityTileRadius,
    };
  }
  return lightCache;
}

function getDarkPalette(): MergedPalette {
  if (!darkCache) {
    darkCache = {
      ...(colors as unknown as Record<string, typeof colors.light>).dark,
      radius: colors.radius,
      activityTileRadius: colors.activityTileRadius,
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
/**
 * L7 — tint a token colour without assuming its format.
 *
 * Call sites did `c.primary + "14"`, which silently produces garbage the
 * moment a token is 3-digit hex, 8-digit hex, or an rgb()/hsl() string — and
 * React Native renders the invalid colour as transparent rather than
 * throwing, so it fails by quietly disappearing.
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const hex = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  let rgb: string | null = null;
  if (short) {
    rgb = `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  } else if (long) {
    rgb = long[1]!;
  }
  if (!rgb) return color; // rgb()/hsl()/named — leave it alone rather than corrupt it
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function useColors(): MergedPalette {
  const scheme = useColorScheme();
  if (scheme === "dark" && "dark" in colors) return getDarkPalette();
  return getLightPalette();
}
