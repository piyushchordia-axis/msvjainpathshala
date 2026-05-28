# Mobile UI Kit — Jain Pathshala (Expo / React Native)

Clickable hi-fi prototype of the parent's-eye view of the mobile app.
Files:

| File | Purpose |
|---|---|
| `index.html` | Stage — phone frame + side jump-nav |
| `ios-frame.jsx` | iPhone bezel (starter component) |
| `tokens.jsx` | JS mirror of `colors_and_type.css` (mirror into `constants/colors.ts` for production) |
| `components.jsx` | `Icon`, `PrimaryButton`/`SecondaryButton`/`GhostButton`, `Avatar`, `AgePill`, `AttendanceChip`, `PunyaBadge`, `TierBadge`, `Card`, `Header`, `TabBar`, `ChildSelector`, `EmptyState` |
| `screens.jsx` | `LoginScreen`, `OtpScreen`, `HomeScreen`, `AttendanceScreen`, `PunyaScreen`, `NoticesScreen`, `NoticeDetail`, `ProfileScreen` |
| `app.jsx` | Router + shared state (active child, screen) |

## Coverage
- Login → OTP → Home (auto-fills + auto-advances after 4 digits)
- Home: child selector pill, Punya summary, attendance CTA, Niyam card, pinned notice
- Attendance: map placeholder + idle / requesting / active states + live timer
- Punya: leaderboard with gold rank-1, "you" highlight
- Notices: list + pinned detail with Confirm / Maybe later
- Profile: ID-style hero, MSV badge, settings list

## Production handoff notes
- In Expo, convert inline styles to `StyleSheet.create`. Icons map to `lucide-react-native`.
- The `IOSDevice` frame is a preview shell only — strip it for the real app.
- `tokens.jsx` should become `constants/colors.ts`, exported as `export const Colors = {...}`.
