/**
 * Zod contracts for bundled / cached Panchang year JSON.
 *
 * Re-export only. The definition lives in @workspace/api-zod so the app and the
 * API cannot disagree about what a Panchang year is — in particular about
 * `provenance` being required, which is the rule that keeps a computed year from
 * ever rendering. Two copies of that rule is one copy that can lose it.
 */
export {
  panchangDaySchema,
  panchangEventSchema,
  panchangMonthMetaSchema,
  panchangPakshaSchema,
  panchangProvenanceSchema,
  panchangTithiStatusSchema,
  panchangYearSchema,
  panchangAnchorIssues,
  SHWETAMBAR_MONTH_KEYS,
} from "@workspace/api-zod";

export type {
  PanchangDay,
  PanchangEvent,
  PanchangMonthMeta,
  PanchangPaksha,
  PanchangProvenance,
  PanchangTithiStatus,
  PanchangYear,
  PanchangAnchorIssue,
} from "@workspace/api-zod";
