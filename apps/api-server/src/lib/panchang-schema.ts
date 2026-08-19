/**
 * Server-side Panchang year Zod.
 *
 * Re-export only — the definition is in @workspace/api-zod, shared with the
 * mobile app. It used to be a hand-kept copy of the mobile schema; the two
 * agreed by luck, and the rule they now both carry (provenance is required,
 * §17.6.1) is exactly the kind that must not depend on luck.
 */
import type { z } from "zod";

export {
  panchangDaySchema,
  panchangEventSchema,
  panchangMonthMetaSchema,
  panchangPakshaSchema,
  panchangProvenanceSchema,
  panchangTithiStatusSchema,
  panchangYearSchema,
  panchangAnchorIssues,
  panchangAnchorDetails,
  SHWETAMBAR_MONTH_KEYS,
} from "@workspace/api-zod";

export type {
  PanchangAnchorIssue,
  PanchangDayPayload,
  PanchangProvenance,
  PanchangYearPayload,
} from "@workspace/api-zod";

/**
 * Re-exported from lib/envelope, where it now lives beside the `fail()` whose
 * `details` argument it feeds. Kept here so existing importers keep working.
 */
export { zodDetails } from "./envelope";
