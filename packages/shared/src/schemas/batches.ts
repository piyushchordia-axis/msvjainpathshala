/** Batches DTOs (SPEC §5.3, §6.3). */

import { z } from 'zod';

import { AGE_GROUPS } from '../enums/age-group.js';

import { bilingualText, isoDatetime, uuid } from './common.js';

const dayOfWeek = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');

export const batchCreateSchema = bilingualText('name', { max: 200 }).merge(
  z.object({
    centre_id: uuid,
    age_group: z.enum(AGE_GROUPS),
    capacity: z.number().int().min(1).max(500),
    /** Days of the week the batch meets. */
    meeting_days: z.array(dayOfWeek).min(1),
    /** Local time the session starts (`HH:MM`, 24h). */
    start_time: hhmm,
    end_time: hhmm,
  }),
);
export type BatchCreateDto = z.infer<typeof batchCreateSchema>;

export const batchUpdateSchema = batchCreateSchema.partial();
export type BatchUpdateDto = z.infer<typeof batchUpdateSchema>;

export const batchSchema = batchCreateSchema.merge(
  z.object({
    id: uuid,
    status: z.enum(['active', 'inactive']),
    current_enrolment: z.number().int().nonnegative(),
    created_at: isoDatetime,
    updated_at: isoDatetime,
  }),
);
export type BatchDto = z.infer<typeof batchSchema>;

export const assignShikshakSchema = z.object({
  batch_id: uuid,
  shikshak_user_id: uuid,
});
export type AssignShikshakDto = z.infer<typeof assignShikshakSchema>;
