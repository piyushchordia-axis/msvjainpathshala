/**
 * Design tokens for Jain Pathshala Mobile.
 *
 * Mirrors the web artifact's HSL token system (artifacts/jain-pathshala/src/index.css)
 * converted to hex so both share the same saffron / maroon / cream identity.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility with scaffold)
    text: "#1A0700",
    tint: "#D55F1A",

    // Core surfaces
    background: "#FBF4EC",
    foreground: "#1A0700",

    // Cards / elevated surfaces
    card: "#FFFFFF",
    cardForeground: "#1A0700",

    // Primary action color (saffron)
    primary: "#D55F1A",
    primaryForeground: "#FFFFFF",

    // Secondary / brand maroon
    secondary: "#761919",
    secondaryForeground: "#FBF4EC",

    // Muted / subdued
    muted: "#F2E8DA",
    mutedForeground: "#8A7460",

    // Accent highlights
    accent: "#FBEEDD",
    accentForeground: "#A8470F",

    // Destructive
    destructive: "#B91C1C",
    destructiveForeground: "#FFFFFF",

    // Borders and inputs
    border: "#E6D6C0",
    input: "#E6D6C0",

    // Extended brand palette
    cream: "#FBF4EC",
    creamDark: "#F2E8DA",
    inkSub: "#8A7460",
    inkDim: "#A2917E",
    gold: "#C8941F",
    saffron: "#D4621A",
    maroon: "#6B1212",

    // Status tokens
    successText: "#157A37",
    successSoft: "#E6F6EC",
    warningText: "#B9710A",
    warningSoft: "#FBF0DC",
    errorText: "#B91C1C",
    errorSoft: "#FAE5E5",
    infoText: "#0A66C2",
    infoSoft: "#E2EFFB",
  },

  // Border radius (px). Synced from web --radius: 0.75rem.
  radius: 12,
};

export default colors;
