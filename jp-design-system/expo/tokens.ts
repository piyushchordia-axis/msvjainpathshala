/**
 * Design tokens for React Native.
 * Mirrors tokens.json — see `/jp-design-system/tokens.json`.
 *
 * Keep in sync with tokens.json by hand, or generate via a build step.
 * Anything not directly usable on RN (CSS strings like `cubic-bezier`,
 * cross-platform shadow strings) is translated to RN-native equivalents.
 */

export const tokens = {
  color: {
    brand: {
      saffron:      '#D4621A',
      saffron700:   '#B5521A',
      saffron300:   '#E8A06A',
      saffron50:    '#FCEFE3',
      maroon:       '#7A1818',
      maroon700:    '#5C1010',
      maroon300:    '#B45C5C',
      maroon50:     '#F4E6E6',
      cream:        '#FDF8F2',
      creamDark:    '#F5EDE0',
      creamDeeper:  '#ECE0CC',
      gold:         '#C8941F',
      gold300:      '#E6C26B',
      gold50:       '#FAF1DC',
    },
    text: {
      primary: '#1A0A00',
      sub:     '#8B6F5E',
      dim:     '#C4A882',
    },
    age: {
      bal:    '#B91C1C',
      kishor: '#854D0E',
      tarun:  '#166534',
      yuva:   '#1E3A8A',
    },
    ageBg: {
      bal:    '#FBE5E5',
      kishor: '#F6ECD6',
      tarun:  '#DCEEDD',
      yuva:   '#DDE3F4',
    },
    tier: {
      jigyasu:    '#8B6F5E',
      shravak:    '#166534',
      sadhak:     '#1E3A8A',
      shraman:    '#7A1818',
      tirthankar: '#C8941F',
    },
    semantic: {
      success:    '#166534', successBg: '#DCEEDD',
      warning:    '#B45309', warningBg: '#FBEED0',
      error:      '#B91C1C', errorBg:   '#FBE5E5',
      info:       '#1E3A8A', infoBg:    '#DDE3F4',
    },
    surface: {
      bg:      '#FDF8F2',
      card:    '#FFFFFF',
      card2:   '#F5EDE0',
      overlay: 'rgba(26,10,0,0.55)',
      divider: '#ECE0CC',
      border:  '#E6D8C2',
    },
  },

  // 4px base scale. Use `tokens.spacing[4]` for 16px etc.
  spacing: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 40, 9: 48, 10: 64, 11: 80 } as const,
  radius:  { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const,

  /**
   * Font family names assume you've loaded these via expo-font / @expo-google-fonts:
   *   @expo-google-fonts/mukta          → Mukta_{400,500,600,700}_*
   *   @expo-google-fonts/tiro-devanagari-sanskrit
   *   @expo-google-fonts/jetbrains-mono
   * If your bundle uses different family names, edit this map.
   */
  font: {
    display:      'TiroDevanagariSanskrit_400Regular',
    body:         'Mukta_400Regular',
    bodyMedium:   'Mukta_500Medium',
    bodySemibold: 'Mukta_600SemiBold',
    bodyBold:     'Mukta_700Bold',
    mono:         'JetBrainsMono_400Regular',
  },

  type: {
    h1:       { fontSize: 32, lineHeight: 40 },
    h2:       { fontSize: 26, lineHeight: 34 },
    h3:       { fontSize: 20, lineHeight: 28 },
    h4:       { fontSize: 17, lineHeight: 24 },
    bodyLg:   { fontSize: 17, lineHeight: 26 },
    body:     { fontSize: 15, lineHeight: 22 },
    label:    { fontSize: 14, lineHeight: 20 },
    caption:  { fontSize: 12, lineHeight: 16 },
    overline: { fontSize: 11, lineHeight: 14, letterSpacing: 1.3 },
  },

  // RN shadow primitives (warm maroon tint — same recipe as CSS box-shadow).
  shadow: {
    1: { shadowColor: '#7A1818', shadowOpacity: 0.06, shadowRadius:  2, shadowOffset: { width: 0, height:  1 }, elevation: 1 },
    2: { shadowColor: '#7A1818', shadowOpacity: 0.10, shadowRadius:  6, shadowOffset: { width: 0, height:  2 }, elevation: 2 },
    3: { shadowColor: '#7A1818', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height:  6 }, elevation: 4 },
    4: { shadowColor: '#7A1818', shadowOpacity: 0.20, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  },

  // Reanimated durations (ms). Use with withTiming(..., { duration }).
  motion: { quick: 140, base: 220, slow: 360 },
} as const;

export type Tokens = typeof tokens;
