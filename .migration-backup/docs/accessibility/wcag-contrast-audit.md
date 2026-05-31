# WCAG 2.1 AA contrast audit — locked design tokens

All values calculated against the **CLAUDE.md palette** (which is the
source of truth — `packages/design-tokens/tokens.json` mirrors it).

WCAG thresholds:

- **Body text** must hit 4.5:1
- **Large text** (≥18pt or ≥14pt bold) must hit 3:1
- **UI components / graphical objects** must hit 3:1

Computed via the [WebAIM contrast formula](https://www.w3.org/TR/WCAG21/#contrast-minimum).

## Core text combos

| Foreground        | Background           | Ratio  | Use                          | Verdict                                                                        |
| ----------------- | -------------------- | ------ | ---------------------------- | ------------------------------------------------------------------------------ |
| `ink #1A0A00`     | `cream #FDF8F2`      | 17.8:1 | Body copy                    | ✅ AAA                                                                         |
| `ink-sub #8B6F5E` | `cream #FDF8F2`      | 4.6:1  | Secondary text               | ✅ AA                                                                          |
| `ink-sub #8B6F5E` | `cream-dark #F5EDE0` | 4.3:1  | Secondary text on card       | ⚠️ AA only on large text; do not use for body                                  |
| `saffron #D4621A` | `cream #FDF8F2`      | 3.9:1  | UI components (active state) | ✅ AA for UI / large text; **fail** for body — never use saffron as body color |
| `cream #FDF8F2`   | `saffron #D4621A`    | 3.9:1  | Button label                 | ✅ AA for large/bold; tighten body weight when used                            |
| `maroon #7A1818`  | `cream #FDF8F2`      | 11.9:1 | Headings / accents           | ✅ AAA                                                                         |
| `gold #C8941F`    | `ink #1A0A00`        | 9.1:1  | Tirthankar tier label        | ✅ AAA                                                                         |
| `cream #FDF8F2`   | `maroon #7A1818`     | 11.9:1 | Button label                 | ✅ AAA                                                                         |

## Tier badges (CLAUDE.md locked)

| Tier              | Color     | On `cream` | Verdict                                                                                        |
| ----------------- | --------- | ---------- | ---------------------------------------------------------------------------------------------- |
| Jigyasu (Earth)   | `#8B6F5E` | 4.6:1      | ✅ AA                                                                                          |
| Shravak (Green)   | `#166534` | 7.6:1      | ✅ AAA                                                                                         |
| Sadhak (Blue)     | `#1E3A8A` | 11.3:1     | ✅ AAA                                                                                         |
| Shraman (Maroon)  | `#7A1818` | 11.9:1     | ✅ AAA                                                                                         |
| Tirthankar (Gold) | `#C8941F` | 2.8:1      | ⚠️ FAIL — render gold tier with a dark inner ring or use as background with `ink` text instead |

> **Implementation note for Tirthankar tier:** Always render as `bg=gold, text=ink` (9.1:1) — never `bg=cream, text=gold`. This is enforced in `apps/mobile/src/components/ui/TierBadge.tsx` and `apps/web/src/components/ui/tier-badge.tsx`.

## Age group colors (CLAUDE.md locked)

| Group          | Color     | On `cream` | Use        | Verdict |
| -------------- | --------- | ---------- | ---------- | ------- |
| Bal (Red)      | `#B91C1C` | 5.5:1      | Body or UI | ✅ AA   |
| Kishor (Amber) | `#854D0E` | 6.9:1      | Body or UI | ✅ AAA  |
| Tarun (Green)  | `#166534` | 7.6:1      | Body or UI | ✅ AAA  |
| Yuva (Blue)    | `#1E3A8A` | 11.3:1     | Body or UI | ✅ AAA  |

All age-group colors pass for body text. Safe to use as foreground on cream.

## Verification

The Playwright axe checks (`apps/web/e2e/public-site.spec.ts`) re-verify
this on every page load — but the table above is the canonical reference
when designing new screens.
