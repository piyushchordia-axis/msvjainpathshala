# Accessibility manual checklist

The Playwright suite (`apps/web/e2e/*.spec.ts`) runs axe-core after every
navigation and fails on WCAG 2.1 AA violations — that covers most static
issues. This checklist is for the things axe can't catch automatically.

Run before every production release.

## Mobile — VoiceOver (iOS) walkthrough

| Step            | Pass criteria                                                                         |
| --------------- | ------------------------------------------------------------------------------------- |
| Open app cold   | App name announced; landing screen first focus = "Sign in" button                     |
| Enter phone     | Phone label, keypad readout, country code announced                                   |
| OTP entry       | "Enter 6 digit code" announced; each digit echoed                                     |
| Home tab        | Tab labels: "Home, current tab"; swipe-right exits to "Children"                      |
| Mark attendance | Each student row reads name + status; toggle says "Present" or "Absent" before action |
| Niyam upload    | Camera permission prompt is reachable; "Take photo" + "Choose existing" are labelled  |
| Exam screen     | Question read fully; options 1/2/3/4 announced with current selection                 |
| Reports         | PDF link announced as "Monthly report, May 2026, download"                            |

## Mobile — TalkBack (Android) walkthrough

| Step             | Pass criteria                                                                 |
| ---------------- | ----------------------------------------------------------------------------- |
| Open app cold    | TalkBack announces "Jain Pathshala home"                                      |
| Phone OTP        | Input fields focusable in order; "Resend OTP in 60 seconds" updates announced |
| Parent dashboard | Tab order: Home → Children → Niyams → Notices → Settings                      |
| Donations        | Amount field labelled "Amount in rupees"; Razorpay sheet escapable via back   |

## Web — keyboard-only walkthrough (Chrome + Firefox + Safari)

| Step                  | Pass criteria                                                              |
| --------------------- | -------------------------------------------------------------------------- |
| Tab through home page | Focus visible on every interactive element; skip-link visible on first Tab |
| Submit donation form  | Tab order matches visual order; Enter submits, Esc closes Razorpay modal   |
| Admin login           | OTP fields focus-trap inside the modal; Esc closes; Tab cycles within      |
| Admin grid            | Tab to first row, arrow keys move within grid; Space activates checkbox    |
| Live admin dashboard  | Live region announces "5 students checked in" when the socket updates      |

## Color & contrast — manual checks

Even with axe passing, double-check on real devices:

- Saffron CTA on cream background — verify on direct sunlight (mobile users)
- Maroon-on-cream notice copy — verify at minimum brightness
- Tier badges (Jigyasu → Tirthankar) — verify each is distinguishable to users
  with deuteranopia (Coblis simulator or built-in iOS color filters)

## Bilingual rendering

- Hindi Devanagari renders with proper baseline (no ascender clipping)
- Mukta font loads on every screen; fallback (`-apple-system`) is rare
- String overflow tested at +35% length (German-length placeholder strings
  in `packages/i18n/__test__/longest-strings.json` for visual review)
