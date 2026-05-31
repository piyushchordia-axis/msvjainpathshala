/** Niyam (vow / task) DTOs (SPEC §5.8, §6.10, §8.4, CLAUDE.md Q5). */

import { z } from 'zod';

import { NIYAM_SUBMISSION_STATUSES, NIYAM_TYPES, PROOF_TYPES } from '../enums/niyam.js';

import { bilingualText, idempotencyKey, isoDatetime, uuid } from './common.js';

export const niyamCreateSchema = bilingualText('title', { max: 200 })
  .merge(bilingualText('description', { max: 2000 }))
  .merge(
    z.object({
      type: z.enum(NIYAM_TYPES),
      proof_type: z.enum(PROOF_TYPES),
      /** Punya points awarded on auto-approval. */
      points: z.number().int().min(1).max(500),
      /** Optional scope — null = national. */
      city_id: uuid.nullable().optional(),
      centre_id: uuid.nullable().optional(),
      batch_id: uuid.nullable().optional(),
    }),
  );
export type NiyamCreateDto = z.infer<typeof niyamCreateSchema>;

export const niyamUpdateSchema = niyamCreateSchema.partial();
export type NiyamUpdateDto = z.infer<typeof niyamUpdateSchema>;

export const niyamSchema = niyamCreateSchema.merge(
  z.object({
    id: uuid,
    status: z.enum(['active', 'archived']),
    created_at: isoDatetime,
    updated_at: isoDatetime,
    deleted_at: isoDatetime.nullable(),
  }),
);
export type NiyamDto = z.infer<typeof niyamSchema>;

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export const niyamSubmitSchema = z.object({
  niyam_id: uuid,
  student_id: uuid,
  /** One or more media_assets ids (photo / video). */
  proof_asset_ids: z.array(uuid).max(5).default([]),
  /** Optional free-form note from the student. */
  note: z.string().max(1000).optional(),
  /** Client-generated for offline-safe replay. */
  client_op_id: idempotencyKey,
  client_timestamp: isoDatetime,
});
export type NiyamSubmitDto = z.infer<typeof niyamSubmitSchema>;

/**
 * Reject a previously auto-approved submission.
 * Only valid within `NIYAM_REVERSAL_WINDOW_DAYS` of `submitted_at`
 * (CLAUDE.md Q5; otherwise returns `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED`).
 */
export const niyamRejectSchema = z.object({
  submission_id: uuid,
  reason: z.string().min(1).max(500),
});
export type NiyamRejectDto = z.infer<typeof niyamRejectSchema>;

export const niyamSubmissionSchema = z.object({
  id: uuid,
  niyam_id: uuid,
  student_id: uuid,
  status: z.enum(NIYAM_SUBMISSION_STATUSES),
  proof_asset_ids: z.array(uuid),
  punya_awarded: z.number().int().nonnegative(),
  submitted_at: isoDatetime,
  rejected_at: isoDatetime.nullable(),
  rejection_reason: z.string().nullable(),
});
export type NiyamSubmissionDto = z.infer<typeof niyamSubmissionSchema>;
