/** Notice DTOs (SPEC §5.10, §6.13, §8.7 — critical SMS fallback). */

import { z } from 'zod';

import { NOTICE_AUDIENCES } from '../enums/notice.js';

import { bilingualText, idempotencyKey, isoDatetime, uuid } from './common.js';

export const noticeCreateSchema = bilingualText('title', { max: 200 })
  .merge(bilingualText('body', { max: 5000 }))
  .merge(
    z.object({
      audience: z.enum(NOTICE_AUDIENCES),
      /** Scope id (city_id / state_id / batch_id) depending on audience. */
      scope_id: uuid.nullable().optional(),
      attachment_asset_ids: z.array(uuid).max(5).default([]),
      /** Critical notices trigger an SMS fallback if push fails (SPEC §8.7). */
      critical: z.boolean().default(false),
    }),
  );
export type NoticeCreateDto = z.infer<typeof noticeCreateSchema>;

export const noticeSchema = noticeCreateSchema.merge(
  z.object({
    id: uuid,
    author_user_id: uuid,
    created_at: isoDatetime,
    deleted_at: isoDatetime.nullable(),
  }),
);
export type NoticeDto = z.infer<typeof noticeSchema>;

export const noticeAcknowledgeSchema = z.object({
  notice_id: uuid,
  client_op_id: idempotencyKey,
  client_timestamp: isoDatetime,
});
export type NoticeAcknowledgeDto = z.infer<typeof noticeAcknowledgeSchema>;
