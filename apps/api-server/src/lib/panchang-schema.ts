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

/** Flatten Zod issues into envelope `details` entries. */
export function zodDetails(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}
