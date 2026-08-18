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

/**
 * Which side of the exact moment the displayed minute must fall on.
 *
 * "start" is a time a vow becomes PERMITTED; "deadline" is a time it expires.
 * It lives on the slot rather than at the call site because a renderer that has
 * to remember which of six rows is a deadline will eventually get one wrong,
 * and the failure is silent — a plausible-looking time that breaks the vow.
 */
export type PachchakkhanBoundary = "start" | "deadline";

export type PachchakkhanSlot = {
  key: PachchakkhanKey;
  /** Product Jain term, romanised — the EN label. */
  label: string;
  /**
   * The Devanagari label.
   *
   * These are Jain terms, not English words, and a Hindi screen was rendering
   * them in Latin script — the Hinglish CLAUDE.md rules out. They ride on the
   * slot rather than being retyped in the card, because a list of six
   * transliterations maintained in two places is a list that drifts.
   */
  label_hi: string;
  /** The exact moment. Never rounded here — see formatTimeIst. */
  atMs: number;
  boundary: PachchakkhanBoundary;
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
    // The five permission times: eating before these breaks the vow.
    {
      key: "navkarsi",
      label: "Navkarsi",
      label_hi: "नवकारसी",
      atMs: sunriseMs + 48 * 60_000,
      boundary: "start",
    },
    {
      key: "porsi",
      label: "Porsi",
      label_hi: "पोरसी",
      atMs: sunriseMs + D / 4,
      boundary: "start",
    },
    {
      key: "sadh_porsi",
      label: "Sadh Porsi",
      label_hi: "साढ़ पोरसी",
      atMs: sunriseMs + (3 * D) / 8,
      boundary: "start",
    },
    {
      key: "purimuddh",
      label: "Purimuddh",
      label_hi: "पुरिमुड्ढ",
      atMs: sunriseMs + D / 2,
      boundary: "start",
    },
    {
      key: "avaddh",
      label: "Avaddh",
      label_hi: "अवड्ढ",
      atMs: sunriseMs + (3 * D) / 4,
      boundary: "start",
    },
    // Chovihar is the one deadline — eating AFTER it breaks the vow.
    {
      key: "chovihar",
      label: "Chovihar",
      label_hi: "चोविहार",
      atMs: sunsetMs,
      boundary: "deadline",
    },
  ];
}
