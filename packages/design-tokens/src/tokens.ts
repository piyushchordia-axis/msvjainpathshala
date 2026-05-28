/**
 * Jain Pathshala — design tokens (TypeScript mirror of tokens.json).
 *
 * Why two files?
 *   • `tokens.json` is the contract for non-TS consumers (Tailwind preset in
 *     apps/web, native code generators, future Style Dictionary pipelines).
 *   • This file is the contract for TS consumers (apps/api, apps/web,
 *     apps/mobile) and uses `as const` so every value narrows to its literal
 *     type — `colors.brand.saffron` autocompletes as `"#D4621A"`, not `string`.
 *
 * They MUST stay in lockstep. `src/index.ts` performs a parity check at module
 * load time and throws if they drift; tests in Step 7 will codify that check.
 */

export const colors = {
  brand: {
    saffron: '#D4621A',
    'saffron-700': '#B5521A',
    'saffron-300': '#E8A06A',
    'saffron-50': '#FCEFE3',
    maroon: '#7A1818',
    'maroon-700': '#5C1010',
    'maroon-300': '#B45C5C',
    'maroon-50': '#F4E6E6',
    cream: '#FDF8F2',
    'cream-dark': '#F5EDE0',
    'cream-deeper': '#ECE0CC',
    gold: '#C8941F',
    'gold-300': '#E6C26B',
    'gold-50': '#FAF1DC',
  },
  text: {
    primary: '#1A0A00',
    sub: '#8B6F5E',
    dim: '#C4A882',
  },
  age: {
    bal: '#B91C1C',
    kishor: '#854D0E',
    tarun: '#166534',
    yuva: '#1E3A8A',
  },
  tier: {
    jigyasu: '#8B6F5E',
    shravak: '#166534',
    sadhak: '#1E3A8A',
    shraman: '#7A1818',
    tirthankar: '#C8941F',
  },
  semantic: {
    success: '#166534',
    'success-bg': '#DCEEDD',
    warning: '#B45309',
    'warning-bg': '#FBEED0',
    error: '#B91C1C',
    'error-bg': '#FBE5E5',
    info: '#1E3A8A',
    'info-bg': '#DDE3F4',
  },
  surface: {
    bg: '#FDF8F2',
    card: '#FFFFFF',
    'card-2': '#F5EDE0',
    'card-3': '#FFFFFF',
    overlay: 'rgba(26,10,0,0.55)',
    divider: '#ECE0CC',
    border: '#E6D8C2',
  },
  dark: {
    bg: '#1A0F08',
    card: '#261A11',
    'card-2': '#2F2117',
    'card-3': '#3A2A1E',
    divider: '#3D2C20',
    border: '#4A3727',
    'text-primary': '#FDF8F2',
    'text-sub': '#C4A882',
    'text-dim': '#8B6F5E',
  },
} as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 48,
  10: 64,
  11: 80,
} as const;

export const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const shadows = {
  1: '0 1px 2px rgba(122,24,24,0.06)',
  2: '0 2px 6px rgba(122,24,24,0.08), 0 1px 2px rgba(122,24,24,0.06)',
  3: '0 8px 24px rgba(122,24,24,0.10), 0 2px 6px rgba(122,24,24,0.06)',
  4: '0 20px 48px rgba(122,24,24,0.16), 0 4px 12px rgba(122,24,24,0.08)',
  focus: '0 0 0 3px rgba(212,98,26,0.28)',
} as const;

export const typography = {
  fonts: {
    display: 'Tiro Devanagari Sanskrit, Mukta, Georgia, serif',
    body: 'Mukta, -apple-system, system-ui, sans-serif',
    mono: 'JetBrains Mono, ui-monospace, Menlo, monospace',
  },
  scale: {
    h1: { size: 32, lh: 40, weight: 600 },
    h2: { size: 26, lh: 34, weight: 600 },
    h3: { size: 20, lh: 28, weight: 600 },
    h4: { size: 17, lh: 24, weight: 600 },
    'body-lg': { size: 17, lh: 26, weight: 400 },
    body: { size: 15, lh: 22, weight: 400 },
    label: { size: 14, lh: 20, weight: 500 },
    caption: { size: 12, lh: 16, weight: 500 },
    overline: { size: 11, lh: 14, weight: 600, tracking: 0.12, transform: 'uppercase' },
  },
} as const;

export const motion = {
  'ease-standard': 'cubic-bezier(.2,.8,.2,1)',
  'ease-emphasis': 'cubic-bezier(.34,1.56,.64,1)',
  duration: {
    quick: 140,
    base: 220,
    slow: 360,
  },
} as const;

// ---------------------------------------------------------------------------
// Convenience aliases mirroring jp-design-system/colors.ts (used by the mobile
// app's `apps/mobile/src/constants/colors.ts`). Keep the field names stable —
// CLAUDE.md "Common pitfalls" calls out hardcoded hex values, so this is the
// import surface that replaces them.
// ---------------------------------------------------------------------------

export const JPColors = {
  saffron: colors.brand.saffron,
  saffron700: colors.brand['saffron-700'],
  saffron300: colors.brand['saffron-300'],
  saffron50: colors.brand['saffron-50'],

  maroon: colors.brand.maroon,
  maroon700: colors.brand['maroon-700'],
  maroon300: colors.brand['maroon-300'],
  maroon50: colors.brand['maroon-50'],

  cream: colors.brand.cream,
  creamDark: colors.brand['cream-dark'],
  creamDeeper: colors.brand['cream-deeper'],

  gold: colors.brand.gold,
  gold300: colors.brand['gold-300'],
  gold50: colors.brand['gold-50'],

  textPrimary: colors.text.primary,
  textSub: colors.text.sub,
  textDim: colors.text.dim,

  border: colors.surface.border,
  divider: colors.surface.divider,
  overlay: colors.surface.overlay,

  // Age groups
  ageBal: colors.age.bal,
  ageKishor: colors.age.kishor,
  ageTarun: colors.age.tarun,
  ageYuva: colors.age.yuva,

  // Spiritual tiers
  tierJigyasu: colors.tier.jigyasu,
  tierShravak: colors.tier.shravak,
  tierSadhak: colors.tier.sadhak,
  tierShraman: colors.tier.shraman,
  tierTirthankar: colors.tier.tirthankar,

  // Semantic
  success: colors.semantic.success,
  successBg: colors.semantic['success-bg'],
  warning: colors.semantic.warning,
  warningBg: colors.semantic['warning-bg'],
  error: colors.semantic.error,
  errorBg: colors.semantic['error-bg'],
  info: colors.semantic.info,
  infoBg: colors.semantic['info-bg'],
} as const;

export const JPSpacing = {
  sp0: spacing[0],
  sp1: spacing[1],
  sp2: spacing[2],
  sp3: spacing[3],
  sp4: spacing[4],
  sp5: spacing[5],
  sp6: spacing[6],
  sp7: spacing[7],
  sp8: spacing[8],
  sp9: spacing[9],
  sp10: spacing[10],
  sp11: spacing[11],
} as const;

export const JPRadius = radii;

export const JPFonts = {
  display: 'Tiro Devanagari Sanskrit',
  body: 'Mukta',
  mono: 'JetBrains Mono',
} as const;

// ---------------------------------------------------------------------------
// Aggregate tokens object (matches the shape of tokens.json without the
// metadata keys). Useful for code that wants to iterate or for snapshot tests.
// ---------------------------------------------------------------------------

export const tokens = {
  colors,
  spacing,
  radii,
  shadows,
  typography,
  motion,
} as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Tokens = typeof tokens;
export type BrandColor = keyof typeof colors.brand;
export type AgeGroupColor = keyof typeof colors.age;
export type TierColor = keyof typeof colors.tier;
export type SemanticColor = keyof typeof colors.semantic;
export type SpacingKey = keyof typeof spacing;
export type RadiusKey = keyof typeof radii;
export type ShadowKey = keyof typeof shadows;
export type TypeScaleKey = keyof typeof typography.scale;
