/**
 * Jain Pathshala — TypeScript color constants.
 * Use this in React Native / Expo (where CSS variables don't apply)
 * or anywhere in JS where you need a hex value directly.
 */
export const JPColors = {
  saffron:      "#D4621A",
  saffron700:   "#B5521A",
  saffron300:   "#E8A06A",
  saffron50:    "#FCEFE3",

  maroon:       "#7A1818",
  maroon700:    "#5C1010",
  maroon300:    "#B45C5C",
  maroon50:     "#F4E6E6",

  cream:        "#FDF8F2",
  creamDark:    "#F5EDE0",
  creamDeeper:  "#ECE0CC",

  gold:         "#C8941F",
  gold300:      "#E6C26B",
  gold50:       "#FAF1DC",

  textPrimary:  "#1A0A00",
  textSub:      "#8B6F5E",
  textDim:      "#C4A882",

  border:       "#E6D8C2",
  divider:      "#ECE0CC",
  overlay:      "rgba(26,10,0,0.55)",

  // age groups
  ageBal:    "#B91C1C", ageBalBg:    "#FBE5E5",
  ageKishor: "#854D0E", ageKishorBg: "#F6ECD6",
  ageTarun:  "#166534", ageTarunBg:  "#DCEEDD",
  ageYuva:   "#1E3A8A", ageYuvaBg:   "#DDE3F4",

  // spiritual tiers
  tierJigyasu:    "#8B6F5E",
  tierShravak:    "#166534",
  tierSadhak:     "#1E3A8A",
  tierShraman:    "#7A1818",
  tierTirthankar: "#C8941F",

  // semantic
  success: "#166534", successBg: "#DCEEDD",
  warning: "#B45309", warningBg: "#FBEED0",
  error:   "#B91C1C", errorBg:   "#FBE5E5",
  info:    "#1E3A8A", infoBg:    "#DDE3F4",
} as const;

export const JPSpacing = {
  sp0: 0,  sp1: 4,  sp2: 8,  sp3: 12,
  sp4: 16, sp5: 20, sp6: 24, sp7: 32,
  sp8: 40, sp9: 48, sp10: 64, sp11: 80,
} as const;

export const JPRadius = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, pill: 999,
} as const;

export const JPFonts = {
  display: "Tiro Devanagari Sanskrit",
  body:    "Mukta",
  mono:    "JetBrains Mono",
} as const;
