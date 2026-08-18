/**
 * Lazy, failure-tolerant resolution of the native PDF reader.
 *
 * WHY THIS IS NOT A PLAIN IMPORT
 *
 * `react-native-pdf` pulls in `react-native-blob-util`, which constructs a
 * `NativeEventEmitter` over a native module DURING MODULE INITIALISATION. Expo
 * Go contains no custom native modules, so that construction throws.
 *
 * A throw at import time is not a broken screen — it is a broken app. Expo
 * Router requires every route module when a navigator builds its screen config,
 * and `library/pdf/[itemId]` is registered on the ROOT stack, so the import ran
 * at launch. A static import here took down sign-in, attendance and everything
 * else in Expo Go, from one line in a leaf screen nobody had navigated to.
 *
 * Hence: never a static import, never at module scope.
 * `lib/library/__tests__/expo-go-safe-routes.test.ts` enforces that across the
 * whole source tree.
 */
import { useEffect, useState } from "react";
import { Platform } from "react-native";
// Type-only: erased at compile time, so this emits no require.
import type PdfComponent from "react-native-pdf";

import { isExpoGo } from "@/lib/expo-go";

export type PdfViewComponent = typeof PdfComponent;

/**
 * The component is carried in a box, never bare.
 *
 * `react-native-pdf`'s default export is `class Pdf extends Component`, and
 * React reads a function passed to `useState`/`setState` as a lazy initialiser
 * or updater — a bare `setView(Pdf)` would CALL the class and throw "Class
 * constructor cannot be invoked without 'new'". Typecheck cannot catch that: a
 * component is assignable to `SetStateAction<Component>` either way. A plain
 * object is not callable, so the mistake cannot be made.
 */
type Resolution = { component: PdfViewComponent | null };

/**
 * Module-level memo so re-entering the reader does not re-import. `undefined`
 * means "not resolved yet"; a box holding `null` means "resolved, and there is
 * no reader here" — a real answer the caller must render for, not a loading
 * state.
 */
let cached: Resolution | undefined;

/** True where the native module is known to be absent, so we never attempt it. */
function nativeReaderImpossible(): boolean {
  return isExpoGo || Platform.OS === "web";
}

async function resolvePdfView(): Promise<Resolution> {
  if (cached !== undefined) return cached;
  if (nativeReaderImpossible()) {
    cached = { component: null };
    return cached;
  }
  try {
    // Dynamic on purpose — the same shape `app/_layout.tsx` uses for
    // expo-notifications. Metro still bundles it; it just is not evaluated
    // until something asks, and a throw here is caught instead of fatal.
    const mod = await import("react-native-pdf");
    cached = { component: mod.default ?? null };
  } catch {
    // A development build made before this dependency landed has the JS but no
    // linked native side. Degrade to the hand-off path rather than crash.
    cached = { component: null };
  }
  return cached;
}

/**
 * `undefined` while resolving, then the component or `null`.
 *
 * Callers should fold `undefined` into their existing loading state so the
 * fallback never flashes before the real reader appears.
 */
export function useLazyPdfView(): PdfViewComponent | null | undefined {
  const [resolution, setResolution] = useState<Resolution | undefined>(cached);

  useEffect(() => {
    if (cached !== undefined) {
      setResolution(cached);
      return;
    }
    let alive = true;
    void resolvePdfView().then((resolved) => {
      if (alive) setResolution(resolved);
    });
    return () => {
      alive = false;
    };
  }, []);

  return resolution === undefined ? undefined : resolution.component;
}

/** Test seam — resets the memo between cases. */
export function __resetPdfViewCacheForTests(): void {
  cached = undefined;
}
