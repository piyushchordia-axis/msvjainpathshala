/**
 * Optional per-city sunrise/sunset overrides (cache + remote stub).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PanchangCity } from "@/lib/panchang/cities";
import {
  computeSunriseSunset,
  localHHmmToMs,
} from "@/lib/panchang/solar";
import {
  sunOverrideFileSchema,
  type SunOverrideFile,
} from "@/lib/panchang/sun-override-schema";

export type SunriseSunsetSource = "override" | "computed";

export type SunriseSunsetResult = {
  sunriseMs: number;
  sunsetMs: number;
  source: SunriseSunsetSource;
};

export function sunOverrideCacheKey(cityKey: string, year: number): string {
  return `jp.panchang.sun_override.${cityKey}.${year}`;
}

export async function readCachedSunOverride(
  cityKey: string,
  year: number,
): Promise<SunOverrideFile | null> {
  try {
    const raw = await AsyncStorage.getItem(sunOverrideCacheKey(cityKey, year));
    if (!raw) return null;
    const parsed = sunOverrideFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeCachedSunOverride(
  data: SunOverrideFile,
): Promise<void> {
  await AsyncStorage.setItem(
    sunOverrideCacheKey(data.cityKey, data.year),
    JSON.stringify(data),
  );
}

/**
 * Stub, and honestly labelled as one.
 *
 * §17.6.5's per-city sunrise/sunset override needs a panchang_city_timings
 * table, and there is none anywhere in lib/db — no migration, no schema, no
 * admin surface. This is not an endpoint that is merely pending: nothing exists
 * to serve. The previous comment ("no endpoint yet") read as though the server
 * side were nearly there, which is how it survived a review.
 *
 * Until that table exists, resolveSunriseSunset falls through to the NOAA solar
 * computation, which is accurate to well under a minute for Indian latitudes —
 * an override refines it, it is not load-bearing.
 */
export async function fetchRemoteSunOverride(
  _cityKey: string,
  _year: number,
): Promise<SunOverrideFile | null> {
  return null;
}

export async function loadSunOverride(
  cityKey: string,
  year: number,
): Promise<SunOverrideFile | null> {
  const cached = await readCachedSunOverride(cityKey, year);
  try {
    const remote = await fetchRemoteSunOverride(cityKey, year);
    if (remote) {
      if (!cached || remote.contentVersion >= cached.contentVersion) {
        await writeCachedSunOverride(remote);
        return remote;
      }
    }
  } catch {
    /* keep cache */
  }
  return cached;
}

/**
 * Prefer override HH:mm for the date when present; else solar computation.
 * Pure core for tests — pass override file in, no I/O.
 */
export function resolveSunriseSunset(opts: {
  city: PanchangCity;
  date: string;
  override: SunOverrideFile | null;
}): SunriseSunsetResult | null {
  const row = opts.override?.days.find((d) => d.date === opts.date);
  if (row) {
    const sunriseMs = localHHmmToMs(opts.date, row.sunrise);
    const sunsetMs = localHHmmToMs(opts.date, row.sunset);
    if (sunriseMs != null && sunsetMs != null && sunsetMs > sunriseMs) {
      return { sunriseMs, sunsetMs, source: "override" };
    }
  }
  const computed = computeSunriseSunset({
    lat: opts.city.lat,
    lng: opts.city.lng,
    date: opts.date,
    timeZone: opts.city.timezone,
  });
  if (!computed) return null;
  return { ...computed, source: "computed" };
}
