/**
 * Which city the Pachchakkhan times are computed for.
 *
 * This used to persist Ahmedabad after a denied location permission, exactly as
 * if the reader had chosen it. Nothing ever asked again, and nothing said the
 * city was a guess: a reader in Bengaluru was shown Ahmedabad's sunset as their
 * Chovihar deadline, forever. Measured against the bundled catalogue that is up
 * to 40 minutes at the solstices — and Chovihar is a DEADLINE, so the error runs
 * late and the vow breaks. (Navkarsi shown late only costs a wait; the asymmetry
 * is why `PachchakkhanSlot.boundary` exists.)
 *
 * Two rules follow, and neither is negotiable:
 *
 *   1. A fallback is NEVER written. Only an explicit choice or a successful fix
 *      persists, so "we do not know" stays distinguishable from "they told us".
 *   2. Permission is never requested as a side effect of opening a screen. The
 *      caller asks in context, having said what the location is for.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  DEFAULT_PANCHANG_CITY_KEY,
  getPanchangCity,
  nearestCity,
  type PanchangCity,
} from "@/lib/panchang/cities";

/** Pre-origin key. Values written by the old code may be a silent fallback. */
export const PANCHANG_CITY_LEGACY_KEY = "jp.panchang.city_key";
export const PANCHANG_CITY_PREF_KEY = "jp.panchang.city";

/**
 * How we came to be showing this city.
 *
 * `fallback` is the honest "nobody has told us and we have not measured" — the
 * default city is still shown, because a Panchang screen with no times on it
 * helps no one, but the UI must offer to fix it rather than present it as
 * settled.
 */
export type PanchangCityOrigin = "chosen" | "located" | "fallback";

export type ResolvedPanchangCity = {
  city: PanchangCity;
  origin: PanchangCityOrigin;
};

type StoredPref = { key: string; origin: "chosen" | "located" };

async function readStoredPref(): Promise<StoredPref | null> {
  try {
    const raw = await AsyncStorage.getItem(PANCHANG_CITY_PREF_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as StoredPref).key === "string"
    ) {
      const origin = (parsed as StoredPref).origin;
      return {
        key: (parsed as StoredPref).key,
        origin: origin === "located" ? "located" : "chosen",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist a settled city.
 *
 * `origin` defaults to "chosen" because every caller that is not the GPS path
 * is acting on something the reader did — picking from the list, or dismissing
 * the offer to locate them. A fallback must not reach this function at all.
 */
export async function writePanchangCityKey(
  key: string,
  origin: "chosen" | "located" = "chosen",
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PANCHANG_CITY_PREF_KEY,
      JSON.stringify({ key, origin } satisfies StoredPref),
    );
    // The legacy key is ambiguous by construction; once a real answer exists it
    // must not be able to come back.
    await AsyncStorage.removeItem(PANCHANG_CITY_LEGACY_KEY);
  } catch {
    /* a preference that fails to save is not worth failing a screen over */
  }
}

/**
 * The active city. Never prompts, never writes — safe on mount.
 *
 * A value under the legacy key is USED but reported as `fallback`: the old code
 * wrote that key both when a reader picked a city and when it gave up, and there
 * is no way to tell which. Showing their city while still offering to locate
 * them costs a reader who chose one dismissal, and rescues every reader who was
 * silently pinned.
 */
export async function resolvePanchangCity(): Promise<ResolvedPanchangCity> {
  const pref = await readStoredPref();
  if (pref) return { city: getPanchangCity(pref.key), origin: pref.origin };

  let legacy: string | null = null;
  try {
    legacy = await AsyncStorage.getItem(PANCHANG_CITY_LEGACY_KEY);
  } catch {
    legacy = null;
  }
  if (legacy) return { city: getPanchangCity(legacy), origin: "fallback" };

  return { city: getPanchangCity(DEFAULT_PANCHANG_CITY_KEY), origin: "fallback" };
}

/**
 * Ask for location and resolve the nearest catalogue city.
 *
 * Call this ONLY from an explicit action — the reader has been told what the
 * location is for and has tapped to allow it. A denial or a failed fix returns
 * the unchanged resolve result and writes nothing, so the offer survives and the
 * next attempt can succeed.
 */
export async function locatePanchangCity(): Promise<ResolvedPanchangCity> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status === "granted") {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const nearest = nearestCity(pos.coords.latitude, pos.coords.longitude);
      await writePanchangCityKey(nearest.key, "located");
      return { city: nearest, origin: "located" };
    }
  } catch {
    /* fall through — a failed fix is not an answer, so nothing is written */
  }
  return resolvePanchangCity();
}

/**
 * The reader has seen the offer and does not want it.
 *
 * Settles whatever city is currently showing, so the prompt does not return on
 * every visit. This is the ONE path by which a default becomes a choice, and it
 * requires a tap.
 */
export async function dismissPanchangCityPrompt(key: string): Promise<void> {
  await writePanchangCityKey(key, "chosen");
}
