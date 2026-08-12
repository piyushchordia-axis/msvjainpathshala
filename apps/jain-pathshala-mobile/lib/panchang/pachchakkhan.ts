/**
 * Derive daily Pachchakkhan timings from sunrise/sunset (render-time only).
 */
export type PachchakkhanKey =
  | "navkarsi"
  | "porsi"
  | "sadh_porsi"
  | "purimuddh"
  | "avaddh"
  | "chovihar";

export type PachchakkhanSlot = {
  key: PachchakkhanKey;
  /** Product Jain term — same in EN/HI UI. */
  label: string;
  atMs: number;
};

/**
 * D = sunset − sunrise
 * Navkarsi   = sunrise + 48 min
 * Porsi      = sunrise + D/4
 * Sadh Porsi = sunrise + 3D/8
 * Purimuddh  = sunrise + D/2
 * Avaddh     = sunrise + 3D/4
 * Chovihar   = sunset
 */
export function derivePachchakkhan(
  sunriseMs: number,
  sunsetMs: number,
): PachchakkhanSlot[] {
  const D = sunsetMs - sunriseMs;
  if (!(D > 0)) return [];
  return [
    { key: "navkarsi", label: "Navkarsi", atMs: sunriseMs + 48 * 60_000 },
    { key: "porsi", label: "Porsi", atMs: sunriseMs + D / 4 },
    { key: "sadh_porsi", label: "Sadh Porsi", atMs: sunriseMs + (3 * D) / 8 },
    { key: "purimuddh", label: "Purimuddh", atMs: sunriseMs + D / 2 },
    { key: "avaddh", label: "Avaddh", atMs: sunriseMs + (3 * D) / 4 },
    { key: "chovihar", label: "Chovihar", atMs: sunsetMs },
  ];
}
