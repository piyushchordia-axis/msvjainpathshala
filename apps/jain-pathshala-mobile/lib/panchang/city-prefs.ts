/**
 * Persisted Panchang city preference + one-shot GPS bootstrap.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  DEFAULT_PANCHANG_CITY_KEY,
  getPanchangCity,
  nearestCity,
  type PanchangCity,
} from "@/lib/panchang/cities";

export const PANCHANG_CITY_PREF_KEY = "jp.panchang.city_key";

export async function readPanchangCityKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PANCHANG_CITY_PREF_KEY);
  } catch {
    return null;
  }
}

export async function writePanchangCityKey(key: string): Promise<void> {
  await AsyncStorage.setItem(PANCHANG_CITY_PREF_KEY, key);
}

/**
 * Resolve the active city: stored pref, else GPS nearest (persisted), else AMD.
 * Safe to call repeatedly — only requests location when no pref exists.
 */
export async function resolvePanchangCity(): Promise<PanchangCity> {
  const stored = await readPanchangCityKey();
  if (stored) return getPanchangCity(stored);

  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status === "granted") {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const nearest = nearestCity(pos.coords.latitude, pos.coords.longitude);
      await writePanchangCityKey(nearest.key);
      return nearest;
    }
  } catch {
    /* fall through to default */
  }

  await writePanchangCityKey(DEFAULT_PANCHANG_CITY_KEY);
  return getPanchangCity(DEFAULT_PANCHANG_CITY_KEY);
}
