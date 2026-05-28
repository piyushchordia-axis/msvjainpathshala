/** Student + enrolment + MSV DTOs (SPEC §5.3, §6.5, §6.6, CLAUDE.md Q1, Q11). */

import { z } from 'zod';

import { AGE_GROUPS } from '../enums/age-group.js';
import { ENROLMENT_STATUSES, MSV_STATUSES, STUDENT_STATUSES } from '../enums/enrolment.js';
import { GENDERS } from '../enums/gender.js';

import { isoDate, isoDatetime, uuid } from './common.js';

export const studentCreateSchema = z.object({
  full_name: z.string().min(1).max(200),
  dob: isoDate,
  gender: z.enum(GENDERS),
  parent_user_id: uuid,
  centre_id: uuid,
  batch_id: uuid,
  age_group: z.enum(AGE_GROUPS),
  /** Free-form dynamic registration payload validated against form_configs (SPEC §5.4). */
  registration_form_data: z.record(z.string(), z.unknown()).default({}),
  /** Parent's consent that the child appears in gallery surfaces (CLAUDE.md Q6). */
  gallery_consent: z.boolean().default(false),
});
export type StudentCreateDto = z.infer<typeof studentCreateSchema>;

export const studentUpdateSchema = studentCreateSchema.partial();
export type StudentUpdateDto = z.infer<typeof studentUpdateSchema>;

export const studentSchema = studentCreateSchema.merge(
  z.object({
    id: uuid,
    status: z.enum(STUDENT_STATUSES),
    /** Set when the student is soft-deactivated (CLAUDE.md Q11 — never hard-deleted). */
    deactivated_at: isoDatetime.nullable(),
    student_view_enabled: z.boolean(),
    msv_status: z.enum(MSV_STATUSES),
    created_at: isoDatetime,
    updated_at: isoDatetime,
  }),
);
export type StudentDto = z.infer<typeof studentSchema>;

// ---------------------------------------------------------------------------
// Enrolment workflow (SPEC §8.1, §6.5)
// ---------------------------------------------------------------------------

export const enrolmentDecisionSchema = z.object({
  student_id: uuid,
  decision: z.enum(['approve', 'reject', 'waitlist']),
  reason: z.string().max(500).optional(),
});
export type EnrolmentDecisionDto = z.infer<typeof enrolmentDecisionSchema>;

export const enrolmentSchema = z.object({
  id: uuid,
  student_id: uuid,
  batch_id: uuid,
  status: z.enum(ENROLMENT_STATUSES),
  decided_by_user_id: uuid.nullable(),
  decided_at: isoDatetime.nullable(),
  created_at: isoDatetime,
  updated_at: isoDatetime,
});
export type EnrolmentDto = z.infer<typeof enrolmentSchema>;

// ---------------------------------------------------------------------------
// MSV (CLAUDE.md Q1 — no eligibility validation; admin discretion only)
// ---------------------------------------------------------------------------

export const msvApplicationSchema = z.object({
  student_id: uuid,
  /** Parent's free-form note explaining why they're applying. */
  note: z.string().max(1000).optional(),
});
export type MsvApplicationDto = z.infer<typeof msvApplicationSchema>;

export const msvDecisionSchema = z.object({
  student_id: uuid,
  decision: z.enum(['approve', 'reject', 'waitlist', 'revoke']),
  reason: z.string().max(500).optional(),
});
export type MsvDecisionDto = z.infer<typeof msvDecisionSchema>;
