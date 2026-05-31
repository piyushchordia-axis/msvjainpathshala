# Mobile performance budgets

Targets per SPEC.md §17 + Step 23 (mid-range Android baseline = Samsung
Galaxy A14, ~₹12,000 device).

| Metric                             | Budget          | Enforcement                                            |
| ---------------------------------- | --------------- | ------------------------------------------------------ |
| Cold start (first activity render) | < 3,000 ms      | Manual measurement before each release on a Galaxy A14 |
| TTI (time to interactive on Home)  | < 4,500 ms      | Same as above                                          |
| APK size                           | < 50 MB         | EAS Build report; fail the build if exceeded           |
| iOS .ipa size                      | < 80 MB         | EAS Build report                                       |
| JS bundle                          | < 4 MB minified | Metro report; surfaced in EAS metadata                 |

## Measurement procedure

1. Clean install via `eas build --profile production --platform android`.
2. Install on the test device via `adb install jp-app.apk`.
3. `adb shell am start -W org.jainpathshala.app/.MainActivity` — read the
   `TotalTime` line.
4. Repeat 5 times; report the median.

## Optimisation hooks already in place

- `react-native-mmkv` (no JSON serialisation overhead for cache).
- `react-query` persisted via `@tanstack/query-async-storage-persister` — page restores feel instant on relaunch.
- `expo-router` lazy mounting of every tab navigator (Step 8).
- `react-native-reanimated` for 60fps animations off the JS thread.

## What to do if a budget is missed

- Identify the offending screen (Flipper → Performance tab).
- Code-split with `import()` and `React.lazy`.
- If `react-native-svg` is loading too many icons, switch the big screens to
  pre-rasterised PNG variants for the splash screens.
