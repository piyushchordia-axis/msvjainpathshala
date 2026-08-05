/** Shared reject-reason presets + client-side length gate for Niyam review. */

export const REJECT_REASON_MIN = 20;
export const REJECT_REASON_MAX = 300;

export type RejectReasonPreset = { en: string; hi: string };

export const REJECT_REASON_PRESETS: RejectReasonPreset[] = [
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

/** Client-side gate mirroring rejectSchema min(20).max(300). */
export function isRejectReasonValid(reason: string): boolean {
  const t = trimRejectReason(reason);
  return t.length >= REJECT_REASON_MIN && t.length <= REJECT_REASON_MAX;
}

export function rejectReasonCharCount(reason: string): number {
  return trimRejectReason(reason).length;
}
