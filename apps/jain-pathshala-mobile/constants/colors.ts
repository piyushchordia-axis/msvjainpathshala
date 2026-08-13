/**
 * Design tokens for Jain Pathshala Mobile.
 *
 * Mirrors the web artifact's HSL token system (apps/jain-pathshala/src/index.css)
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

    // Punya spiritual tiers (CLAUDE.md locked colours)
    tierJigyasu: "#8B6F5E",
    tierShravak: "#166534",
    tierSadhak: "#1E3A8A",
    tierShraman: "#7A1818",
    tierTirthankar: "#C8941F",

    // Status tokens
    successText: "#157A37",
    successSoft: "#E6F6EC",
    warningText: "#B9710A",
    warningSoft: "#FBF0DC",
    errorText: "#B91C1C",
    errorSoft: "#FAE5E5",
    infoText: "#0A66C2",
    infoSoft: "#E2EFFB",

    // Activity grid — high-contrast tile ink
    activityInk: "#2D3748",
    activityInkStrong: "#1A202C",

    // Activity grid pastels (parent/student 9 + Guruji/admin extras)
    activityNotifications: "#FCE4D6",
    activityAttendance: "#D9EAD3",
    activityNiyam: "#E1D5E7",
    activityCourses: "#D0E0E3",
    activityCertificates: "#FFF2CC",
    activityHomework: "#F4CCCC",
    activityQuizzes: "#D5E8D4",
    activityExams: "#DAE8FC",
    activityCompetitions: "#FFE599",
    activityStudents: "#C9DAF8",
    activityBatches: "#B4A7D6",
    activityPunya: "#FFE599",
    activityJoin: "#EAD1DC",
    activityProfile: "#D9D2E9",
    activityCentres: "#A2C4C9",
    activityShikshaks: "#D5A6BD",
    activityHolidays: "#B6D7A8",
    activityNotices: "#F9CB9C",
    activityServiceRequests: "#EA9999",
    activityGallery: "#E6B8AF",
    activityReports: "#CFE2F3",
    activityEnrolments: "#FCE5CD",
    activityLibrary: "#FFE6CC",
    activityShivirs: "#F8CBAD",
  },

  // Border radius (px). Synced from web --radius: 0.75rem.
  radius: 12,
  // Activity tiles only — do not use for cards.
  activityTileRadius: 16,
};

export default colors;
