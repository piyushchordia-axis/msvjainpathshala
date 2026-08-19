/**
 * Niyam reject-reason presets + the length gate shared by both review surfaces
 * and the API.
 *
 * Lives here because BOTH surfaces need it: the web admin panel could not
 * import from inside the mobile app, so it grew its own inline copy of the
 * bounds and shipped with no presets at all, while mobile had three bilingual
 * ones. `rejectSchema` in the API imports the same constants, so the client
 * gate and the server gate cannot drift.
 *
 * Deliberately NOT the generic `REJECT_REASON_MIN`/`MAX` in contracts.ts: those
 * are 10/300 and gate ENROLMENT rejections (SAN-API-03). A niyam rejection
 * reverses Punya and breaks a streak, and its minimum has always been 20. The
 * two are different thresholds for different decisions — do not merge them.
 */

export const NIYAM_REJECT_REASON_MIN = 20;
export const NIYAM_REJECT_REASON_MAX = 300;

export type NiyamRejectReasonPreset = { en: string; hi: string };

export const NIYAM_REJECT_REASON_PRESETS: NiyamRejectReasonPreset[] = [
  {
    en: "The photo does not clearly show the Niyam being performed — please retake and submit again.",
    hi: "फ़ोटो में नियम स्पष्ट नहीं दिख रहा — कृपया दोबारा लेकर जमा करें।",
  },
  {
    en: "This was submitted for the wrong date — please resubmit against the correct day.",
    hi: "यह गलत तिथि के लिए जमा हुआ है — सही दिन के लिए फिर से जमा करें।",
  },
  {
    en: "The proof is missing — please attach a photo and submit again.",
    hi: "प्रमाण गायब है — कृपया फ़ोटो जोड़कर फिर से जमा करें।",
  },
];

export function trimRejectReason(reason: string): string {
  return reason.trim();
}

/** Client-side gate mirroring the API's niyam rejectSchema min/max. */
export function isNiyamRejectReasonValid(reason: string): boolean {
  const t = trimRejectReason(reason);
  return t.length >= NIYAM_REJECT_REASON_MIN && t.length <= NIYAM_REJECT_REASON_MAX;
}

export function niyamRejectReasonCharCount(reason: string): number {
  return trimRejectReason(reason).length;
}
