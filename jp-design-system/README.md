# Jain Pathshala — Design System Export

Drop-in package for using the Jain Pathshala visual system inside a Replit project (or any web project).

## What's in here

| File | Purpose |
|---|---|
| `tokens.css` | All design tokens as CSS custom properties + utility classes (`jp-h1`, `jp-body`, `jp-page`, etc). Imports the fonts. |
| `tokens.json` | Same tokens as data — feed your own build / Tailwind config. |
| `tailwind.config.js` | Ready-made Tailwind preset. Use as `presets: [require('./jp-design-system/tailwind.config.js')]`. |
| `colors.ts` | TS constants for React Native / non-CSS contexts. |
| `example.html` | Minimum working page you can open in Replit's preview. |
| `assets/` | Logo lockups + mandala motif (SVG). |
| `DESIGN_GUIDE.md` | The full written brand & voice guide. **Read this first.** |
| `Design System.html` | Visual index — open in Replit preview to browse every token & component card. |
| `preview/` | One HTML card per token/component (colors, type, buttons, cards, badges, tabbar, GPS session, ID card, leaderboard, …). Static reference. |
| `ui_kits/mobile/` | Clickable React mobile prototype — parent's-eye view of the Expo app. JSX, runs in browser via Babel. |
| `ui_kits/admin/` | Clickable React web-admin prototype — Sanchalak dashboard with sidebar, tables, forms. |

---

## UI kits — what they are and how to use them

The two kits in `ui_kits/` are **clickable hi-fi prototypes**, not an npm-installable component library. They load React + Babel from a CDN and render entirely in the browser — you can open `ui_kits/mobile/index.html` or `ui_kits/admin/index.html` directly in a Replit preview.

**Mobile kit** (`ui_kits/mobile/`) covers Login → OTP → Home → Attendance (GPS) → Punya leaderboard → Notices → Profile, plus all the shared pieces (`PrimaryButton`, `Avatar`, `AgePill`, `AttendanceChip`, `PunyaBadge`, `TierBadge`, `Card`, `Header`, `TabBar`, `ChildSelector`, `EmptyState`).

**Admin kit** (`ui_kits/admin/`) covers the Sanchalak dashboard: sidebar nav, KPI cards, student table with filters, attendance grid, audit log, forms.

**Porting to production:**
- **For a Next.js / Vite Repl:** copy `components.jsx` and the screens you need into your `components/` folder, swap the inline `style={{}}` objects for Tailwind classes (the preset already maps them — `bg-saffron`, `rounded-md`, etc), and replace the `Icon` placeholder with `lucide-react`.
- **For an Expo Repl:** components are written with React DOM (`<div>`, `<button>`); you'll translate each one to `View` / `Pressable` / `Text`. The `tokens.jsx` file in `ui_kits/mobile/` becomes your `constants/colors.ts`. Strip `ios-frame.jsx` — it's a preview-only bezel.

**Use `preview/` as your component catalogue** — every card there is a small, isolated HTML reference for one piece of UI (a button, a chip, an empty state). It's the fastest way to remind yourself what a primary button looks like or how an age pill is styled before you go rebuild it in your stack.

---

## How to use it in Replit

### Option A — plain HTML / CSS Repl (fastest)

1. Upload the entire `jp-design-system/` folder into your Repl.
2. In every HTML page, link the stylesheet **once** in `<head>`:
   ```html
   <link rel="stylesheet" href="/jp-design-system/tokens.css" />
   ```
3. Add `class="jp-page"` to `<body>` for the cream baseline.
4. Use the variables anywhere:
   ```css
   .my-card {
     background: var(--jp-surface);
     border: 1px solid var(--jp-border);
     border-radius: var(--r-md);
     box-shadow: var(--sh-1);
     padding: var(--sp-5);
   }
   ```
5. Or the prebuilt classes:
   ```html
   <h1 class="jp-h1">Jain Pathshala</h1>
   <p class="jp-body">Welcome back, Aarav.</p>
   ```

Open `jp-design-system/example.html` in the Replit preview to verify fonts and colours are loading.

### Option B — Next.js / Vite + Tailwind Repl

1. Upload the folder into your project root.
2. In `tailwind.config.js`:
   ```js
   const jp = require("./jp-design-system/tailwind.config.js");
   module.exports = {
     presets: [jp],
     content: ["./pages/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
   };
   ```
3. In your global stylesheet (`globals.css` / `index.css`), import the tokens **above** the Tailwind directives so the fonts load and CSS vars are available everywhere:
   ```css
   @import "./jp-design-system/tokens.css";
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```
4. Now utilities work out of the box:
   ```html
   <button class="bg-saffron hover:bg-saffron-700 text-white rounded-md px-sp5 py-sp3 shadow-1 font-body">
     Mark attendance
   </button>
   <span class="bg-age-tarun-bg text-age-tarun rounded-pill px-sp3 py-sp1 text-caption">
     Tarun
   </span>
   ```

### Option C — Expo / React Native Repl

CSS variables don't apply, so use the TS constants:
```ts
import { JPColors, JPSpacing, JPRadius } from "./jp-design-system/colors";

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp5,
  },
  button: { backgroundColor: JPColors.saffron, borderRadius: JPRadius.md },
});
```
Install the fonts via `expo-font` — load `Mukta` (body) and `Tiro Devanagari Sanskrit` (display) from Google Fonts at app startup.

---

## Rules to keep things on-brand

These come straight from `DESIGN_GUIDE.md`. Read the guide for the full version.

1. **Page background is always cream** (`var(--jp-bg)`). No gradients on body.
2. **Saffron is the only action colour.** Buttons, active tab, FAB.
3. **Maroon is for headings and brand chrome**, not actions.
4. **Default radius is 12px** (`--r-md`). Pills only on chips, age tags, and the child selector.
5. **Shadows are warm** (maroon-tinted). Don't drop a flat gray shadow — `--sh-1` to `--sh-4` are the only allowed values.
6. **Default everything to icon + text** for CTAs and tabs. Icon-only requires a 44×44 target and an `aria-label`.
7. **No emoji in product UI.**
8. **Age & tier colours are identity colours**, not state colours. Never use Bal-red as an error.
9. **Bottom-tab clearance**: reserve 84px on every mobile scroll surface.
10. **Devanagari needs room**: minimum 22px line-height on labels; allow +35% string length on translations.

---

## Fonts

`tokens.css` already imports them from Google Fonts:

- **Tiro Devanagari Sanskrit** — display (H1/H2 in maroon)
- **Mukta** — body (covers Devanagari + Gujarati + Latin, 8 weights)
- **JetBrains Mono** — code only

If your Replit blocks external CDNs, self-host: download the WOFF2 files from Google Fonts → put them in `assets/fonts/` → replace the `@import` at the top of `tokens.css` with local `@font-face` declarations.

---

## Verifying it works

Open `example.html` in your Replit preview. You should see:

- Cream page background (warm off-white, not pure white)
- A maroon serif heading "Jain Pathshala"
- A saffron button with a soft maroon-tinted shadow
- A green "Tarun" pill

If the heading falls back to Georgia or the button looks gray instead of saffron, the stylesheet path is wrong — fix the `<link href>` and reload.

---

## Open questions (carried over from the guide)

- **MSV badge** — meaning still unconfirmed; treated as a gold honors ribbon for now.
- **Display face** — Tiro Devanagari Sanskrit is a default; swap if there's a commissioned wordmark face.
- **Icons** — using Lucide as placeholder; custom Punya / tier / Niyam icons need design.
