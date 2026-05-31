# Jain Pathshala — Design System

> A complete visual + interaction language for **Jain Pathshala**, a mobile-first education-management platform for Jain religious learning centres across India.

---

## Product context

**Jain Pathshala** is a growing network of Jain religious-education centres (पाठशालाएँ) for children and young adults. The product digitises and strengthens Jain values education for the next generation. The platform spans:

- **Mobile app** (Expo / React Native) — primary surface, used daily by:
  - **Guruji / Didi** — teachers
  - **Parent** — receives updates, manages multiple children
  - **Student (13+)** — own login, sees own progress
- **Web admin panel** (Next.js) — used by:
  - **Sanchalak** — centre head, runs a single pathshala
  - **City Admin** — oversees a city's pathshalas
  - **Super Admin** — platform-wide

**Tone**: rooted in tradition, warm and community-driven, trustworthy, spiritually meaningful — yet modern and accessible on phones. Saffron + cream is the dominant feel; never a cold "developer" or fintech aesthetic.

### Sources used
**None attached.** This system was built from the written brief alone — no Figma file, no codebase. All visual decisions (font pairing, illustration style, component geometry) are reasoned defaults from the brief; the brand palette and age/tier codes are taken **exactly** from the brief and locked. Please re-attach Figma and the Expo repo so we can align components 1:1.

---

## Index — what's where

| Path | What |
|---|---|
| `README.md` | This document |
| `colors_and_type.css` | All design tokens as CSS custom properties (light + dark) |
| `tokens.json` | Same tokens, JSON form — feeds `constants/colors.ts` and Tailwind |
| `assets/` | Logo lockups, motif SVGs, illustration placeholders |
| `preview/` | One HTML card per token/component — feeds the Design System tab |
| `ui_kits/mobile/` | Expo/React Native UI kit — clickable mobile prototype |
| `ui_kits/admin/` | Next.js web admin UI kit — sidebar + tables + forms |
| `SKILL.md` | Agent-skill manifest (works in Claude Code too) |

---

## Content Fundamentals — how copy is written

**Voice: warm elder + modern teacher.** Speak to parents and students as a respected member of the community would — kind, direct, and never preachy. Hindi/Sanskrit terms (Pathshala, Punya, Guruji, Sanchalak, Niyam, Shivir) are kept untranslated because they carry meaning; everything else is plain modern English (or the user's chosen language).

**Person.** Address the user as **"you"**. Refer to teachers as **Guruji** or **Didi**, never "the teacher". Children are called **students** in admin contexts and by name (or "your child") in parent contexts.

**Casing.**
- Sentence case for buttons, headings, list items: `Mark attendance`, `View today's homework`.
- Title Case only for proper nouns and Sanskrit terms: `Punya Points`, `Tirthankar tier`, `Shivir 2026`.
- **NEVER** ALL CAPS for body copy. Overlines (the only uppercase) are SemiBold, 11px, +12% tracked.

**Numbers & units.**
- Punya: `120 Punya` (no abbreviation; the word matters).
- Attendance: `28 / 30` or `93%`, never `28 out of 30 days present this month` unless space allows.
- Dates: `Tue, 12 Aug` in mobile lists; `12 August 2025` in formal places (ID cards, certificates).

**Emoji.** **No emoji in product UI.** They flatten the tone. Use the icon set instead. The single exception: festival broadcast messages from City Admin may carry one motif (e.g. 🪔 for Diwali greetings) — handled as illustration, not text.

**Examples — Do.**
> "Aarav has marked **Present** for today. Punya +5."
> "3 new notices from Mahavir Centre."
> "Your Niyam streak is on day 7. Don't break the chain."

**Examples — Don't.**
> ~~"Hey there! 👋 Looks like your kiddo crushed it today!! 🎉"~~ — too casual, off-brand.
> ~~"Attendance has been successfully recorded in the system."~~ — robotic.
> ~~"The teacher will review your submission."~~ — say `Guruji will review`.

**Errors.** State the problem and the fix in one sentence: `That OTP is incorrect — check your SMS and try again.` Never `Error 401` or `Something went wrong`.

**Multilingual.** English, Hindi (Devanagari), Gujarati, Marathi. The font (`Mukta`) covers all four. Layouts must tolerate +35% string length and Devanagari's taller ascenders — give labels 22px line-height minimum.

---

## Visual Foundations

### Mood
Saffron warmth on cream paper. Think **palm-leaf manuscript**, **temple lamp glow**, **handloom textile** — not glossy fintech, not "edtech bright". The system uses **earth-toned shadows** (tinted toward maroon, not gray) so cards sit on cream without looking cold.

### Color
Three primary roles:
- **Saffron `#D4621A`** — the only color used for primary action. Buttons, active tab, FAB. Saturated but warm.
- **Maroon `#7A1818`** — display headings, secondary CTAs, header bars, brand chrome.
- **Cream `#FDF8F2`** — every page background. Cards sit on cream as `#FFFFFF` or `#F5EDE0`.

Age-group and tier colors are **identity colors**, not action colors — never use Bal-red as an error state or Tarun-green as a success state inside an age-coded screen.

### Typography
- **Display**: `Tiro Devanagari Sanskrit` — single-weight serif designed for Devanagari, evokes manuscript dignity. Used for H1/H2 in maroon. *(Substitution flagged — Google Fonts default; please confirm or supply a licensed brand display face.)*
- **Body**: `Mukta` — humanist sans with 8 weights, ships with strong Devanagari + Gujarati + Latin glyphs. All UI text.
- **Mono**: `JetBrains Mono` — code snippets only.

### Spacing & Grid
4px base, scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80`. Mobile uses a single column with 16px page gutters; tablet promotes to 2-col at 768px with 24px gutters. Bottom-tab clearance: **84px** reserved on all scroll surfaces (`safe-area-inset-bottom + 56px tab + 12px breathing room`).

### Backgrounds
- Default surface is **flat cream** (`#FDF8F2`). No gradients on page backgrounds.
- Header bars on mobile use a **subtle saffron-to-cream wash** (`linear-gradient(180deg, #FDF8F2 0%, #FFFFFF 100%)`) so the maroon title sits cleanly.
- A **single decorative motif** (faint mandala SVG @ 6% opacity, top-right of hero areas) is the only allowed background ornament. Never tile patterns under body content — it fights Devanagari.
- Empty-states use a centred illustration on cream; no shape behind.

### Cards
- Default card: `background: #FFFFFF`, `border-radius: 12px`, `border: 1px solid #E6D8C2`, `box-shadow: 0 1px 2px rgba(122,24,24,.06)`.
- Elevated card (notices, GPS session): `border-radius: 16px`, `box-shadow: 0 8px 24px rgba(122,24,24,.10)`, no border.
- Pressed card depresses 1px, shadow drops to `sh-1`, content scales `.99` over 140ms.

### Corner Radii
`4 / 8 / 12 / 16 / 24 / pill`. **Default everything to 12px.** Pills are reserved for chips, age-group tags, and the child-selector. Avoid mixing radii within one card.

### Shadows
Warm/tinted, four steps (`sh-1` → `sh-4`). All carry a maroon undertone so they look intentional on cream. **Never** drop a flat-gray shadow.

### Borders
1px hairlines in `#E6D8C2` (cream-deeper). Divider lines on dense lists use the same hairline at full-width. Focused inputs swap border for a 2px saffron with a 3px `rgba(212,98,26,.28)` ring.

### Hover / Press / Focus / Disabled
| State | Treatment |
|---|---|
| Hover (web) | overlay `rgba(212,98,26,0.08)` on the fill; cursor pointer |
| Pressed | scale `0.98`, fill darkens to `--jp-saffron-700`, 140ms `ease-standard` |
| Focused | 2px saffron border + 3px saffron-28% ring |
| Disabled | fg `--jp-text-dim`, bg `#EFE6D5`, 60% opacity icons, no shadow |

### Transparency & Blur
- **iOS tab bar**: 18px blur over cream-90% (`rgba(253,248,242,0.85)`).
- **Android tab bar**: solid cream (no blur).
- Modals dim the page with `rgba(26,10,0,0.55)` overlay + no blur (perf on low-end Android).
- Avoid frosted-glass elsewhere — it dilutes the warm palette.

### Motion
- Standard easing: `cubic-bezier(.2,.8,.2,1)`. Durations: 140 / 220 / 360ms.
- **Celebrations** (tier upgrade, birthday) use `cubic-bezier(.34,1.56,.64,1)` — slight overshoot — and add a saffron/maroon/gold confetti burst lasting 1.4s.
- Page transitions: **slide-from-right** for forward navigation, **fade** for tab switches.
- Attendance tap: chip scales to 1.1 → settles to 1.0 with check-mark stroke draw (220ms).
- Loading: **skeleton bars** in `#F5EDE0` shimmering with a 1.2s saffron-light sweep at 8% opacity. No spinners except inside buttons.

### Layout Rules
- Mobile screens always reserve top-safe + 56px header + 84px bottom-tab.
- Headers are sticky and lose elevation only at scrollY=0.
- Content max-width on tablet: 640px center; on web admin: 1280px.
- The **Child Selector pill** lives in the top-right of the parent header, persists across tabs.

---

## Iconography

We standardise on **Lucide** (24px, 1.75 stroke, rounded joins) as the workhorse set — open-source, comprehensive, and its stroke quality matches our type weight. Lucide ships via CDN, so the mobile bundle stays light.

**Custom icons** (Punya lotus, tier crests, Jain swastika in respectful contexts, mandala motif) live in `assets/icons/` as SVG and are drawn at the same 24×24 / 1.75-stroke spec so they sit cleanly next to Lucide glyphs. Cultural symbols are flagged for review before shipping — we copy them in, we never invent them.

**Sizing.** 16px (inline with caption), 20px (inside chips), 24px (default), 32px (tab bar, primary action), 48px+ (illustration accent).

**Color.** Icons inherit `currentColor`. On cream surfaces use `--jp-text-sub` for neutral, `--jp-saffron` for active, `--jp-maroon` for chrome. **Never** color an icon by hue alone to indicate state — pair with a label.

**Icon-only vs icon+label.** Icon-only is allowed only when:
1. the action is universally understood (close, back, search, more),
2. there is an accessible label (`aria-label`, `accessibilityLabel`),
3. tap target ≥ 44×44.

Every primary CTA uses **icon + text**. Every tab bar item uses **icon + text**.

**Emoji / Unicode.** Not used in UI. Festival broadcasts may render a single illustrated motif image, not the emoji codepoint.

> **Substitution flagged:** Lucide is our CDN fallback because no brand icon set was provided. If you have a custom set (Figma library or SVG export), drop it into `assets/icons/` and we'll cut Lucide.

---

## Quick start for designers

1. Copy `colors_and_type.css` into your page; or import `tokens.json` into your Tailwind config.
2. Use `--font-display` for H1/H2 in maroon; everything else `--font-body`.
3. Stick to the spacing scale — `--sp-4` (16px) is the gutter default.
4. When in doubt, **more cream, less color**.

---

## Caveats & open questions

- **No design source attached.** Font pairing, illustration style, and component geometry are reasoned proposals. Please share Figma / Expo repo to align.
- **MSV badge** — the brief mentions it but doesn't define MSV. Treated as a gold "honors" ribbon on avatars/ID cards. Confirm the meaning.
- **Devanagari display face** — Tiro Devanagari Sanskrit is a strong default but if Jain Pathshala already commissioned a wordmark face, swap it in.
- **Iconography** — Lucide is a placeholder. Custom icons for Punya / tiers / Niyam need design.
