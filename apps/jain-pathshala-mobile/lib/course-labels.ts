/**
 * Course UI copy — CU11 status labels, CU17 three-branch honorific.
 * Never hardcode "Guruji" for null/other gender.
 */

export type CourseProgressStatus = "not_started" | "in_progress" | "completed";

/** CU11 — not_started surfaces as "to be started". */
export function courseStatusLabel(
  status: CourseProgressStatus | null | undefined,
  hi: boolean,
): string {
  if (status == null) return "—";
  if (status === "not_started") return hi ? "शुरू करना बाकी" : "To be started";
  if (status === "in_progress") return hi ? "चल रहा है" : "In progress";
  return hi ? "पूर्ण" : "Completed";
}

/** CU17 — three branches; nullable/other must not default to Guruji. */
export function certifiedLabel(
  gender: string | null | undefined,
  hi: boolean,
): string {
  if (gender === "male") return hi ? "गुरुजी द्वारा प्रमाणित" : "Certified by Guruji";
  if (gender === "female") return hi ? "दीदी द्वारा प्रमाणित" : "Certified by Didi";
  return hi ? "प्रमाणित" : "Certified";
}

export function certifiedFrozenExplanation(hi: boolean): string {
  return hi
    ? "यह नोड प्रमाणित है — स्थिति बदल नहीं सकती। प्रमाणन अपरिवर्तनीय है।"
    : "This node is certified — status cannot change. Certification is irreversible.";
}
