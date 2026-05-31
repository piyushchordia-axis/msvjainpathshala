# Expo / React Native — Jain Pathshala mobile component pack

9 components, Expo-compatible, no web APIs. All text via props (no hardcoded English).

## What's here

```
expo/
├── tokens.ts                          # Mirrors tokens.json — colors, spacing, radii, shadows, motion
└── components/
    ├── AttendanceToggle.tsx           # 3-state present/absent/late radio, Reanimated press + fill
    ├── CalendarHeatmapCell.tsx        # 0–4 intensity bucket, 3 ramps, today ring on a wrapper
    ├── OfflineBanner.tsx              # soft/hard severity, slides in via Reanimated
    ├── PunyaTierBadge.tsx             # Jigyasu → Tirthankar; gold ring on Tirthankar
    ├── StreakBadge.tsx                # live/broken/milestone; flame pulses while live
    ├── ScannerSuccessOverlay.tsx      # full-screen modal, ring pop + lift, auto-dismiss
    ├── ScannerErrorOverlay.tsx        # full-screen modal, shake animation, retry + cancel
    ├── TabBarBadge.tsx                # dot or numeric ("99+" cap), 3 variants
    └── NotificationItem.tsx           # row + read state + kind dot + leading/trailing slots
```

## Install in your Expo Repl

```bash
npx create-expo-app@latest my-app -t expo-template-blank-typescript
cd my-app
npx expo install react-native-reanimated expo-image
npx expo install @expo-google-fonts/mukta @expo-google-fonts/tiro-devanagari-sanskrit @expo-google-fonts/jetbrains-mono expo-font
```

Add the Reanimated Babel plugin (it must be last):

```js
// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

## Load fonts at startup

```tsx
// app/_layout.tsx (Expo Router) or App.tsx
import { useFonts, Mukta_400Regular, Mukta_500Medium, Mukta_600SemiBold, Mukta_700Bold } from '@expo-google-fonts/mukta';
import { TiroDevanagariSanskrit_400Regular } from '@expo-google-fonts/tiro-devanagari-sanskrit';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';

export default function Root() {
  const [loaded] = useFonts({
    Mukta_400Regular, Mukta_500Medium, Mukta_600SemiBold, Mukta_700Bold,
    TiroDevanagariSanskrit_400Regular,
    JetBrainsMono_400Regular,
  });
  if (!loaded) return null;
  return /* your tree */;
}
```

The family-name strings used in `tokens.ts` exactly match what `@expo-google-fonts/*` exports, so once `useFonts` resolves, every component picks them up automatically.

## Drop in

```bash
cp -R expo/tokens.ts        my-app/src/design/tokens.ts
cp -R expo/components/*.tsx my-app/src/components/jp/
```

Then import:

```tsx
import { AttendanceToggle, type AttendanceState } from '@/components/jp/AttendanceToggle';
import { useTranslation } from 'react-i18next';

const [status, setStatus] = useState<AttendanceState | null>(null);
const { t } = useTranslation();

<AttendanceToggle
  value={status}
  onChange={setStatus}
  options={[
    { value: 'present', label: t('attendance.present') },
    { value: 'absent',  label: t('attendance.absent') },
    { value: 'late',    label: t('attendance.late') },
  ]}
  accessibilityLabel={t('attendance.markStatus')}
/>
```

## Conventions every component in this pack follows

| Rule | Why |
|---|---|
| **`View` / `Text` / `Pressable` only** — no `div` / `span` / `button` anywhere. | RN doesn't support them. |
| **All strings via props.** Nothing English-hardcoded. | i18n. The caller decides the language. |
| **All text wrapped in `<Text>`** — never bare strings inside `<View>`. | RN throws "Text strings must be rendered within a `<Text>` component". |
| **Styles live in `StyleSheet.create({})` blocks** — token values referenced via `tokens.*`, no Tailwind. | Type-safe + native-fast. |
| **`style` prop accepted on every component**, merged last. | Lets callers override layout without forking. |
| **Animations via Reanimated 3** — `useSharedValue` + `useAnimatedStyle`, never the LayoutAnimation API or the Animated module. | Reanimated runs on the UI thread; pulses and overlays stay smooth on low-end Android. |
| **`gap` over `margin`** for sibling spacing (RN ≥ 0.71 / Expo SDK 50+). | Survives DOM reorder cleanly; matches the CSS version. |
| **Accessibility:** `accessibilityRole`, `accessibilityLabel`, `accessibilityState`, `accessibilityLiveRegion` on every interactive surface. | Screen readers + RTL. |
| **`hitSlop` on small targets** (heatmap cells, retry button on the offline banner). | Apple HIG: 44pt minimum; small visuals can stay small if their hit area is padded out. |
| **No `window`, `document`, `setTimeout` for animation timing** — only `setTimeout` in `useEffect` for auto-dismiss, cleaned up on unmount. | RN-safe. |

## Component-specific notes

- **`PunyaTierBadge`** ships pre-composited tints (`#F1EAE0`, `#DCEEDD`, …) instead of `#XXXXXX` + opacity. Some Android paint pipelines round-trip alpha inconsistently, especially on cream backgrounds; solid hex avoids the seam.
- **`CalendarHeatmapCell`** puts the "today" ring on a wrapper `View` so the cell stays the same visual size. RN's `borderWidth` grows the box (no CSS-style `outline` to fall back on).
- **`StreakBadge`** uses nested `<Text>` for the number + unit so they share a baseline. The flame slot is `useSharedValue`-driven with `withRepeat`/`withSequence` for the pulse.
- **`Scanner*Overlay`** use `accessibilityViewIsModal` + an absolute-positioned `Pressable` scrim that captures tap-out. Auto-dismiss is opt-in (`autoDismissMs`).
- **`TabBarBadge`** sets `allowFontScaling={false}` so the count doesn't blow out the icon on iOS Dynamic Type's larger sizes.
- **`OfflineBanner`** drives `accessibilityLiveRegion="polite"` so VoiceOver/TalkBack announce the message on appearance.

## Not in this pack (port these later)

- **TabBar shell** — depends on which navigator you pick (Expo Router tabs / React Navigation). `TabBarBadge` is the part that's portable; bolt it onto your tab's icon slot.
- **Buttons / Card / Avatar / Header** — translate these straight from `ui_kits/mobile/components.jsx`; they're all just `View` + `Text` + `Pressable`.
- **Icons** — pass any node into the `icon` / `leading` slots. Recommended: `lucide-react-native` for parity with the Lucide set used elsewhere in the system.
