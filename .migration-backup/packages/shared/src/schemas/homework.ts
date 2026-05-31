/** Homework DTOs (SPEC §5.9, §6.12). */

import { z } from 'zod';

import { HOMEWORK_STATUSES } from '../enums/homework.js';

import { bilingualText, idempotencyKey, isoDate, isoDatetime, uuid } from './common.js';

export const homeworkCreateSchema = bilingualText('title', { max: 200 })
  .merge(bilingualText('instructions', { max: 4000 }))
  .merge(
    z.object({
      batch_id: uuid,
      due_date: isoDate,
      attachment_asset_ids: z.array(uuid).max(5).default([]),
    }),
  );
export type HomeworkCreateDto = z.infer<typeof homeworkCreateSchema>;

export const homeworkSubmitSchema = z.object({
  homework_id: uuid,
  student_id: uuid,
  attachment_asset_ids: z.array(uuid).min(1).max(5),
  note: z.string().max(2000).optional(),
  client_op_id: idempotencyKey,
  client_timestamp: isoDatetime,
});
export type HomeworkSubmitDto = z.infer<typeof homeworkSubmitSchema>;

export const homeworkDecisionSchema = z.object({
  submission_id: uuid,
  decision: z.enum(['approve', 'star']),
  feedback: z.string().max(1000).optional(),
});
export type HomeworkDecisionDto = z.infer<typeof homeworkDecisionSchema>;

export const homeworkSubmissionSchema = z.object({
  id: uuid,
  homework_id: uuid,
  student_id: uuid,
  status: z.enum(HOMEWORK_STATUSES),
  attachment_asset_ids: z.array(uuid),
  submitted_at: isoDatetime,
  feedback: z.string().nullable(),
});
export type HomeworkSubmissionDto = z.infer<typeof homeworkSubmissionSchema>;
