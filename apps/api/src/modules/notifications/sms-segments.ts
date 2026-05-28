/**
 * SMS segment math (SPEC §8.7).
 *
 * - GSM-7 (ASCII-ish): 160 chars per segment; 153 per segment when >1
 *   segment because of the UDH overhead.
 * - UCS-2 (Devanagari + any non-GSM char): 70 chars per segment; 67
 *   per segment when >1 segment.
 *
 * The "is-Devanagari?" test is conservative: any char outside the
 * GSM-7 default alphabet trips it. The MSG91 docs require this so we
 * don't accidentally pay 70-char segments for an emoji-laden ASCII
 * body.
 *
 * Cost = segments × `costPerSegmentPaise` (env-driven, default 25 paise).
 */

// Subset of the GSM-7 default alphabet used by SMS — anything outside
// triggers Unicode encoding. Extension set characters (€, [, \, ], …)
// occupy two chars in GSM-7; we treat them as Unicode to stay safe.
const GSM7 = new Set<string>(
  Array.from(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
  ),
);

export function isUnicodeBody(text: string): boolean {
  for (const ch of text) {
    if (!GSM7.has(ch)) return true;
  }
  return false;
}

export function computeSegments(text: string): { segments: number; encoding: 'gsm7' | 'ucs2' } {
  if (text.length === 0) return { segments: 0, encoding: 'gsm7' };
  if (isUnicodeBody(text)) {
    // Devanagari path — UCS-2.
    const len = text.length;
    if (len <= 70) return { segments: 1, encoding: 'ucs2' };
    return { segments: Math.ceil(len / 67), encoding: 'ucs2' };
  }
  const len = text.length;
  if (len <= 160) return { segments: 1, encoding: 'gsm7' };
  return { segments: Math.ceil(len / 153), encoding: 'gsm7' };
}

export function computeCostPaise(text: string, costPerSegmentPaise: number): number {
  const { segments } = computeSegments(text);
  return segments * costPerSegmentPaise;
}

/**
 * Truncate to fit in a single segment (best-effort). Useful for the
 * notice critical-fallback path which has a hard 160/70-char ceiling.
 */
export function truncateToSingleSegment(text: string): string {
  if (text.length === 0) return text;
  if (isUnicodeBody(text)) {
    return text.length <= 70 ? text : `${text.slice(0, 67)}…`;
  }
  return text.length <= 160 ? text : `${text.slice(0, 157)}...`;
}
