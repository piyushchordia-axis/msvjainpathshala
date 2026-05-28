/** Student + enrolment + MSV DTOs (SPEC §5.3, §6.5, §6.6, CLAUDE.md Q1, Q11).
 *
 * The schemas here are the canonical READ shapes that API responses must
 * match. WRITE shapes (POST/PATCH bodies) live next to the controllers
 * that own them so the business rules — who can change which columns —
 * stay with the route. Earlier versions of this file exported
 * `studentCreateSchema` / `studentUpdateSchema` / `enrolmentDecisionSchema`
 * / `msvDecisionSchema` as nominal "write shapes," but they didn't match
 * what any controller actually validated and were classic traps for the
 * next contributor (see the OTP verify incident: shared schema sat
 * unused while the controller validated a different shape, and the mobile
 * client wired to the wrong one). Apply-side write shapes that DO match a
 * route are kept here (e.g. `msvApplicationSchema`) and imported by the
 * controller.
 */

import { z } from 'zod';

import { AGE_GROUPS } from '../enums/age-group.js';
import { ENROLMENT_STATUSES, MSV_STATUSES, STUDENT_STATUSES } from '../enums/enrolment.js';
import { GENDERS } from '../enums/gender.js';

import { isoDate, isoDatetime, uuid } from './common.js';

export const studentSchema = z.object({
  id: uuid,
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
  status: z.enum(STUDENT_STATUSES),
  /** Set when the student is soft-deactivated (CLAUDE.md Q11 — never hard-deleted). */
  deactivated_at: isoDatetime.nullable(),
  student_view_enabled: z.boolean(),
  msv_status: z.enum(MSV_STATUSES),
  created_at: isoDatetime,
  updated_at: isoDatetime,
});
export type StudentDto = z.infer<typeof studentSchema>;

// ---------------------------------------------------------------------------
// Enrolment workflow (SPEC §8.1, §6.5)
// ---------------------------------------------------------------------------

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

/**
 * Body for `POST /v1/msv/enrolments` (the parent's apply call). Used by the
 * MsvController via direct import — single source of truth.
 */
export const msvApplicationSchema = z.object({
  student_id: uuid,
  /** Parent's free-form note explaining why they're applying. */
  note: z.string().max(1000).optional(),
});
export type MsvApplicationDto = z.infer<typeof msvApplicationSchema>;
