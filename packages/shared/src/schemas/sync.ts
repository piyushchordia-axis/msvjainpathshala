/** Offline sync DTOs (SPEC §6.23, §8.10, §8.11). */

import { z } from 'zod';

import { SYNC_OP_KINDS, SYNC_RESULT_STATUSES } from '../enums/sync.js';

import { idempotencyKey, isoDatetime, uuid } from './common.js';

export const syncOperationSchema = z.object({
  /** Client-generated ULID/UUID — must be globally unique per user. */
  client_op_id: idempotencyKey,
  op_kind: z.enum(SYNC_OP_KINDS),
  /** Operation-specific payload (validated downstream against the matching schema). */
  payload: z.record(z.string(), z.unknown()),
  client_timestamp: isoDatetime,
});
export type SyncOperationDto = z.infer<typeof syncOperationSchema>;

export const syncBatchSchema = z.object({
  ops: z.array(syncOperationSchema).min(1).max(200),
});
export type SyncBatchDto = z.infer<typeof syncBatchSchema>;

export const syncResultSchema = z.object({
  client_op_id: idempotencyKey,
  /** Subset of SYNC_OP_STATUSES — `processing` never reaches the wire. */
  status: z.enum(SYNC_RESULT_STATUSES),
  result: z.record(z.string(), z.unknown()).optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
});
export type SyncResultDto = z.infer<typeof syncResultSchema>;

export const syncBatchResponseSchema = z.object({
  results: z.array(syncResultSchema),
  server_timestamp: isoDatetime,
});
export type SyncBatchResponse = z.infer<typeof syncBatchResponseSchema>;

export const syncBootstrapResponseSchema = z.object({
  user_id: uuid,
  /** Subset of state needed for offline-first first-launch — shape filled in per role at Step 5+. */
  payload: z.record(z.string(), z.unknown()),
  generated_at: isoDatetime,
});
export type SyncBootstrapResponse = z.infer<typeof syncBootstrapResponseSchema>;
