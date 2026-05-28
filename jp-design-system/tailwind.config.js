/**
 * Jain Pathshala — Tailwind config preset.
 * Mirrors tokens.json so utilities like `bg-saffron`, `text-maroon`,
 * `rounded-md`, `shadow-2`, `font-display` map straight to the system.
 *
 * Usage in Replit (Next.js / Vite / CRA + Tailwind):
 *   const jp = require("./jp-design-system/tailwind.config.js");
 *   module.exports = { presets: [jp], content: [...] };
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        saffron: {
          DEFAULT: "#D4621A",
          50: "#FCEFE3", 300: "#E8A06A", 700: "#B5521A",
        },
        maroon: {
          DEFAULT: "#7A1818",
          50: "#F4E6E6", 300: "#B45C5C", 700: "#5C1010",
        },
        cream: {
          DEFAULT: "#FDF8F2",
          dark: "#F5EDE0",
          deeper: "#ECE0CC",
        },
        gold: {
          DEFAULT: "#C8941F",
          50: "#FAF1DC", 300: "#E6C26B",
        },
        ink: {
          DEFAULT: "#1A0A00",   // text-primary
          sub:     "#8B6F5E",
          dim:     "#C4A882",
        },
        age: {
          bal:    "#B91C1C", "bal-bg":    "#FBE5E5",
          kishor: "#854D0E", "kishor-bg": "#F6ECD6",
          tarun:  "#166534", "tarun-bg":  "#DCEEDD",
          yuva:   "#1E3A8A", "yuva-bg":   "#DDE3F4",
        },
        tier: {
          jigyasu:    "#8B6F5E",
          shravak:    "#166534",
          sadhak:     "#1E3A8A",
          shraman:    "#7A1818",
          tirthankar: "#C8941F",
        },
        success: { DEFAULT: "#166534", bg: "#DCEEDD" },
        warning: { DEFAULT: "#B45309", bg: "#FBEED0" },
        error:   { DEFAULT: "#B91C1C", bg: "#FBE5E5" },
        info:    { DEFAULT: "#1E3A8A", bg: "#DDE3F4" },
        border: { jp: "#E6D8C2" },
      },
      fontFamily: {
        display: ['"Tiro Devanagari Sanskrit"', "Mukta", "Georgia", "serif"],
        body:    ["Mukta", "-apple-system", "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      fontSize: {
        h1:       ["32px", { lineHeight: "40px", fontWeight: "600" }],
        h2:       ["26px", { lineHeight: "34px", fontWeight: "600" }],
        h3:       ["20px", { lineHeight: "28px", fontWeight: "600" }],
        h4:       ["17px", { lineHeight: "24px", fontWeight: "600" }],
        "body-lg":["17px", { lineHeight: "26px" }],
        body:     ["15px", { lineHeight: "22px" }],
        label:    ["14px", { lineHeight: "20px", fontWeight: "500" }],
        caption:  ["12px", { lineHeight: "16px", fontWeight: "500" }],
        overline: ["11px", { lineHeight: "14px", fontWeight: "600", letterSpacing: "0.12em" }],
      },
      spacing: {
        // 4px base — `p-sp4` = 16px etc. Keep alongside Tailwind defaults.
        sp0: "0px",  sp1: "4px",  sp2: "8px",  sp3: "12px",
        sp4: "16px", sp5: "20px", sp6: "24px", sp7: "32px",
        sp8: "40px", sp9: "48px", sp10:"64px", sp11:"80px",
      },
      borderRadius: {
        xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px", pill: "999px",
      },
      boxShadow: {
        1: "0 1px 2px rgba(122,24,24,0.06)",
        2: "0 2px 6px rgba(122,24,24,0.08), 0 1px 2px rgba(122,24,24,0.06)",
        3: "0 8px 24px rgba(122,24,24,0.10), 0 2px 6px rgba(122,24,24,0.06)",
        4: "0 20px 48px rgba(122,24,24,0.16), 0 4px 12px rgba(122,24,24,0.08)",
        focus: "0 0 0 3px rgba(212,98,26,0.28)",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(.2,.8,.2,1)",
        emphasis: "cubic-bezier(.34,1.56,.64,1)",
      },
      transitionDuration: {
        quick: "140ms",
        base:  "220ms",
        slow:  "360ms",
      },
    },
  },
};
