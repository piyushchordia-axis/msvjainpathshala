/**
 * Bundled Pathshala city catalog for Pachchakkhan solar timings.
 */
import catalog from "@/assets/data/panchang-cities.json";

export type PanchangCity = {
  key: string;
  name_en: string;
  name_hi: string;
  lat: number;
  lng: number;
  timezone: "Asia/Kolkata";
};

export const DEFAULT_PANCHANG_CITY_KEY = "AMD";

export const PANCHANG_CITIES: PanchangCity[] = catalog as PanchangCity[];

export function getPanchangCity(key: string): PanchangCity {
  return (
    PANCHANG_CITIES.find((c) => c.key === key) ??
    PANCHANG_CITIES.find((c) => c.key === DEFAULT_PANCHANG_CITY_KEY)!
  );
}

export function cityDisplayName(city: PanchangCity, hi: boolean): string {
  return hi ? city.name_hi || city.name_en : city.name_en;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function nearestCity(
  lat: number,
  lng: number,
  cities: PanchangCity[] = PANCHANG_CITIES,
): PanchangCity {
  let best = cities[0]!;
  let bestKm = Infinity;
  for (const c of cities) {
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  }
  return best;
}
