/**
 * Zod contract for optional per-city sunrise/sunset override files.
 */
import { z } from "zod";

export const sunOverrideDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sunrise: z.string().regex(/^\d{1,2}:\d{2}$/),
  sunset: z.string().regex(/^\d{1,2}:\d{2}$/),
});

export const sunOverrideFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  contentVersion: z.number().int().positive(),
  cityKey: z.string().min(1),
  year: z.number().int(),
  days: z.array(sunOverrideDaySchema),
});

export type SunOverrideDay = z.infer<typeof sunOverrideDaySchema>;
export type SunOverrideFile = z.infer<typeof sunOverrideFileSchema>;
