/**
 * Server-side Panchang year JSON Zod (mirrors mobile schema).
 */
import { z } from "zod";

export const panchangPakshaSchema = z.enum(["sud", "vad"]);
export const panchangTithiStatusSchema = z.enum(["normal", "kshay", "vridhi"]);

export const panchangEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title_en: z.string(),
  title_hi: z.string(),
  title_gu: z.string().nullable().optional(),
  note_en: z.string().nullable(),
  note_hi: z.string().nullable(),
  note_gu: z.string().nullable().optional(),
  highlight: z.boolean(),
  linkedItemId: z.string().uuid().nullable(),
});

export const panchangDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vaar: z.string().min(1),
  month: z.string().min(1),
  isAdhikMaas: z.boolean(),
  paksha: panchangPakshaSchema,
  tithi: z.number().int().min(1).max(15),
  tithiKey: z.string().min(1),
  tithiStatus: panchangTithiStatusSchema,
  nakshatra: z.string().min(1),
  parvTithi: z.boolean(),
  events: z.array(panchangEventSchema),
});

export const panchangMonthMetaSchema = z.object({
  key: z.string().min(1),
  name_en: z.string(),
  name_hi: z.string(),
  name_gu: z.string().nullable().optional(),
  isAdhik: z.boolean().optional(),
});

export const panchangYearSchema = z.object({
  schemaVersion: z.number().int().positive(),
  contentVersion: z.number().int().positive(),
  sect: z.string().min(1),
  vikramSamvat: z.number().int(),
  veerSamvat: z.number().int(),
  year: z.number().int().optional(),
  months: z.array(panchangMonthMetaSchema).min(1),
  days: z.array(panchangDaySchema).min(1),
});

export type PanchangYearPayload = z.infer<typeof panchangYearSchema>;
export type PanchangDayPayload = z.infer<typeof panchangDaySchema>;

/** Flatten Zod issues into envelope `details` entries. */
export function zodDetails(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}
