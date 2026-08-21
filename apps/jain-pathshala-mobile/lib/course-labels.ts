/**
 * Course UI copy — CU11 status labels, CU17 three-branch honorific.
 * Never hardcode "Guruji" for null/other gender.
 */

export type CourseProgressStatus = "not_started" | "in_progress" | "completed";

/** Keys into useColors() / colors.light — never raw hex at call sites. */
export type CourseStripTone = "muted" | "warningSoft" | "successSoft" | "accent";

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

/**
 * Strip background tone for learner rows.
 * Certified overrides status colour (gold/accent + star); status still drives icons.
 */
export function courseStripTone(
  status: CourseProgressStatus | null | undefined,
  certified: boolean,
): CourseStripTone {
  if (certified) return "accent";
  if (status === "in_progress") return "warningSoft";
  if (status === "completed") return "successSoft";
  return "muted";
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

/** L17-client — bilingual label instead of the raw `courses.kind` enum value. */
export function courseKindLabel(kind: string, hi: boolean): string {
  if (kind === "msv") return "MSV";
  if (kind === "standard") return hi ? "मानक" : "Standard";
  return kind;
}

/**
 * H23/CU32 — one bilingual, problem-and-fix mapping for the six course error
 * codes, reused across every catch handler so the copy cannot drift per site.
 * CU21 — ERR_COURSE_STUDENT_OUT_OF_SCOPE names the Sanchalak handoff: a
 * student whose batch changed needs the centre head, not a retry.
 */
export function courseErrorCopy(
  code: string | undefined,
  hi: boolean,
  fallbackBody: string,
): { title: string; body: string } {
  switch (code) {
    case "ERR_COURSE_NODE_CERTIFIED":
      return {
        title: hi ? "प्रमाणित नोड" : "Certified node",
        body: certifiedFrozenExplanation(hi),
      };
    case "ERR_COURSE_NODE_NOT_COMPLETE":
      return {
        title: hi ? "अभी पूर्ण नहीं" : "Not complete yet",
        body: hi
          ? "प्रमाणित करने से पहले इसे “पूर्ण” के रूप में चिह्नित करें, फिर फिर कोशिश करें।"
          : "Mark this as completed before it can be certified, then try again.",
      };
    case "ERR_COURSE_NODE_HAS_CERTIFICATIONS":
      return {
        title: hi ? "प्रमाणन मौजूद हैं" : "Certifications exist",
        body: hi
          ? "इसमें प्रमाणित प्रगति है इसलिए इसे हटाया नहीं जा सकता — इसके बजाय पाठ्यक्रम संग्रहित करें।"
          : "This can't be deleted — it has certified progress. Archive the course instead.",
      };
    case "ERR_COURSE_NODE_NOT_FOUND":
      return {
        title: hi ? "नोड नहीं मिला" : "Node not found",
        body: hi
          ? "यह अनुभाग या उप-अनुभाग अब मौजूद नहीं है — रीफ़्रेश करें।"
          : "This section or subsection no longer exists — refresh and try again.",
      };
    case "ERR_COURSE_STUDENT_OUT_OF_SCOPE":
      return {
        title: hi ? "विद्यार्थी आपके दायरे से बाहर है" : "Student outside your scope",
        body: hi
          ? "यह विद्यार्थी अब आपके बैच में नहीं है — इसे संभालने के लिए अपने संचालक से कहें।"
          : "This student is no longer in your batch — ask your Sanchalak to handle it.",
      };
    case "ERR_COURSE_NOT_PUBLISHABLE":
      return {
        title: hi ? "पाठ्यक्रम तैयार नहीं" : "Course not ready",
        body: hi
          ? "यह पाठ्यक्रम अभी प्रकाशित करने योग्य नहीं है।"
          : "This course isn't publishable yet.",
      };
    default:
      return { title: hi ? "त्रुटि" : "Error", body: fallbackBody };
  }
}

/**
 * CU22 — mirrors resolveCourseAwardPoints (apps/api-server/src/lib/course-points.ts)
 * exactly, using the same punya_configs/punya_features rows the server reads,
 * so the CU18 confirm can show the real clamped value instead of the raw
 * authored punya_points. A missing/inactive config awards 0 (H3), never an
 * unclamped multiply. Mirrors resolveClampedCoursePoints in
 * apps/jain-pathshala/src/pages/admin/CoursesAdminPage.tsx (H16) — same
 * approach, reused rather than reinvented.
 */
export type CoursePunyaConfigRow = {
  feature_key: string;
  points: number;
  is_active: boolean;
  city_id: string | null;
};

export type CoursePunyaFeatureRow = {
  key: string;
  min_points: number;
  max_points: number;
  is_active: boolean;
};

export function resolveClampedCoursePoints(
  authoredPoints: number,
  featureKey: "course_section_certified" | "course_completed",
  cityId: string | null,
  configs: CoursePunyaConfigRow[],
  features: CoursePunyaFeatureRow[],
): number {
  if (authoredPoints <= 0) return 0;
  const feature = features.find((f) => f.key === featureKey && f.is_active);
  if (!feature) return 0;
  const cityConfig = cityId
    ? configs.find((c) => c.feature_key === featureKey && c.city_id === cityId && c.is_active)
    : undefined;
  const globalConfig = configs.find(
    (c) => c.feature_key === featureKey && c.city_id == null && c.is_active,
  );
  const multiplier = cityConfig?.points ?? globalConfig?.points ?? null;
  if (multiplier == null || multiplier <= 0) return 0;
  let points = Math.round((authoredPoints * multiplier) / 100);
  if (feature.min_points > 0 && points < feature.min_points) points = feature.min_points;
  if (feature.max_points > 0 && points > feature.max_points) points = feature.max_points;
  return Math.max(0, points);
}

/**
 * The shape `sectionProgressSummary` needs. Structural, not the DTO, so this
 * module stays free of anything that reaches react-native — the test bundler
 * cannot parse react-native's Flow syntax, and this file must stay importable.
 */
export type SectionProgressInput = {
  derived_leaf_total: number;
  derived_leaf_reached: number;
  derived_coverage: number | null;
  punya_points: number;
  certified_at?: string | null;
  certified_by_gender?: string | null;
};

export type SectionProgressSummary = {
  /** "3 of 8 done" — omitted when the section has no leaves to count. */
  countLine: string | null;
  /** 0..1 for the bar, or null when there is nothing to fill. */
  fraction: number | null;
  /** "38%" — null whenever `fraction` is. */
  percentLabel: string | null;
  /** "40 Punya" — omitted at zero rather than shown as a nil reward. */
  punyaLine: string | null;
  /** Certified wording (CU17 honorific), when the section is certified. */
  certifiedLine: string | null;
};

/**
 * One-line progress facts for a section header.
 *
 * `derived_coverage` is preferred for the bar because it is what the server
 * computed; the reached/total pair is only a fallback so a section still shows
 * a bar when coverage is null. Both are already in the course tree payload —
 * this adds no request.
 */
export function sectionProgressSummary(
  section: SectionProgressInput,
  hi: boolean,
): SectionProgressSummary {
  const total = Math.max(0, Math.trunc(section.derived_leaf_total ?? 0));
  const reached = Math.min(total, Math.max(0, Math.trunc(section.derived_leaf_reached ?? 0)));

  const countLine =
    total > 0 ? (hi ? `${total} में से ${reached} पूर्ण` : `${reached} of ${total} done`) : null;

  const fromCoverage =
    section.derived_coverage == null ? null : Math.min(1, Math.max(0, section.derived_coverage));
  const fraction = fromCoverage ?? (total > 0 ? reached / total : null);
  const percentLabel = fraction == null ? null : `${Math.round(fraction * 100)}%`;

  // Zero points is not a reward worth advertising — an empty row reads better
  // than "0 Punya" next to a section nobody gets credit for.
  const punyaLine =
    section.punya_points > 0
      ? hi
        ? `${section.punya_points} पुण्य`
        : `${section.punya_points} Punya`
      : null;

  const certifiedLine = section.certified_at
    ? certifiedLabel(section.certified_by_gender, hi)
    : null;

  return { countLine, fraction, percentLabel, punyaLine, certifiedLine };
}

/**
 * CU16 — a section carries its own declared status AND a derived roll-up
 * over its sub-sections; both are surfaced, and divergence between them is
 * information for the Sanchalak, never an error and never auto-corrected
 * (that auto-correction is exactly what the deleted course-progress-cascade
 * module used to do — see CU15/CU16 and C4/M24 in the courses review).
 */
export type SectionDivergenceInput = {
  status: CourseProgressStatus;
  derived_status: CourseProgressStatus | null;
  derived_leaf_total: number;
  derived_leaf_reached: number;
  status_diverges: boolean;
};

/**
 * One-line "declared vs derived" note for a section, or null when there is
 * nothing to say (no divergence, or the section has no sub-sections to roll
 * up — `derived_status` is null in that case, per fn_course_progress/CU28).
 */
export function divergenceNote(section: SectionDivergenceInput, hi: boolean): string | null {
  if (!section.status_diverges || section.derived_status == null) return null;
  const declared = courseStatusLabel(section.status, hi);
  const derived = courseStatusLabel(section.derived_status, hi);
  const count = `${section.derived_leaf_reached}/${section.derived_leaf_total}`;
  return hi
    ? `घोषित: ${declared} · उप-अनुभागों से: ${derived} (${count})`
    : `Declared: ${declared} · from sub-sections: ${derived} (${count})`;
}

/**
 * A one-line preview of a subsection description for a list row.
 *
 * Descriptions are plain text (the admin edits them in a plain textarea), so
 * this only has to collapse whitespace — no HTML to strip. Falls back across
 * languages so a row is not blank just because one translation is missing.
 */
export function descriptionPreview(
  descriptionEn: string | null | undefined,
  descriptionHi: string | null | undefined,
  hi: boolean,
  maxChars = 120,
): string | null {
  const first = hi ? descriptionHi : descriptionEn;
  const second = hi ? descriptionEn : descriptionHi;
  const raw = (first?.trim() || second?.trim() || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return raw.length <= maxChars ? raw : `${raw.slice(0, maxChars - 1).trimEnd()}…`;
}
