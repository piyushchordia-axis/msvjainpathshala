/**
 * Brand typography — Outfit (UI), DM Mono (numbers), Mukta + Tiro (Hindi).
 * Fonts are loaded in app/_layout.tsx.
 */

export const fonts = {
  /* Outfit — Latin UI */
  display: "Outfit_700Bold",
  displayExtraBold: "Outfit_800ExtraBold",
  displayBlack: "Outfit_900Black",
  body: "Outfit_400Regular",
  bodyMedium: "Outfit_500Medium",
  bodySemiBold: "Outfit_600SemiBold",
  bodyBold: "Outfit_700Bold",

  /* Hindi — Devanagari fallbacks */
  displayHi: "TiroDevanagariSanskrit_400Regular",
  bodyHi: "Mukta_400Regular",
  bodyHiMedium: "Mukta_500Medium",
  bodyHiSemiBold: "Mukta_600SemiBold",
  bodyHiBold: "Mukta_700Bold",

  /* DM Mono — amounts, stats, codes, OTP */
  mono: "DMMono_400Regular",
  monoMedium: "DMMono_500Medium",
} as const;

export function displayFamily(hi: boolean): string {
  return hi ? fonts.displayHi : fonts.display;
}

export function bodyFamily(
  hi: boolean,
  weight: "regular" | "medium" | "semibold" | "bold" = "regular",
): string {
  if (hi) {
    const hiMap = {
      regular: fonts.bodyHi,
      medium: fonts.bodyHiMedium,
      semibold: fonts.bodyHiSemiBold,
      bold: fonts.bodyHiBold,
    } as const;
    return hiMap[weight];
  }
  const map = {
    regular: fonts.body,
    medium: fonts.bodyMedium,
    semibold: fonts.bodySemiBold,
    bold: fonts.bodyBold,
  } as const;
  return map[weight];
}
