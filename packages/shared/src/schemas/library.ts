/** Library DTOs (SPEC §5.16, §6.20, CLAUDE.md Q7 — video embeds only). */

import { z } from 'zod';

import { LIBRARY_ACCESS_TIERS, LIBRARY_CONTENT_TYPES } from '../enums/library.js';

import { bilingualText, isoDatetime, uuid } from './common.js';

const YOUTUBE_OR_VIMEO_URL =
  /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\/.+/i;

/**
 * Either `embed_url` (for `type='video'` per CLAUDE.md Q7) OR `asset_id`
 * (for pdf / audio / image) must be set — never both.
 */
export const libraryItemCreateSchema = bilingualText('title', { max: 200 })
  .merge(bilingualText('description', { max: 2000 }))
  .merge(
    z.object({
      type: z.enum(LIBRARY_CONTENT_TYPES),
      access_tier: z.enum(LIBRARY_ACCESS_TIERS),
      embed_url: z
        .string()
        .url()
        .regex(YOUTUBE_OR_VIMEO_URL, 'Embed URL must be YouTube or Vimeo')
        .optional(),
      asset_id: uuid.optional(),
      tags: z.array(z.string().max(40)).max(20).default([]),
    }),
  )
  .superRefine((val, ctx) => {
    if (val.type === 'video') {
      if (!val.embed_url) {
        ctx.addIssue({
          path: ['embed_url'],
          code: z.ZodIssueCode.custom,
          message: 'embed_url is required for video items (CLAUDE.md Q7)',
        });
      }
      if (val.asset_id) {
        ctx.addIssue({
          path: ['asset_id'],
          code: z.ZodIssueCode.custom,
          message: 'asset_id must not be set for video items — use embed_url only',
        });
      }
    } else {
      if (!val.asset_id) {
        ctx.addIssue({
          path: ['asset_id'],
          code: z.ZodIssueCode.custom,
          message: 'asset_id is required for non-video items',
        });
      }
      if (val.embed_url) {
        ctx.addIssue({
          path: ['embed_url'],
          code: z.ZodIssueCode.custom,
          message: 'embed_url is only allowed for type=video',
        });
      }
    }
  });
export type LibraryItemCreateDto = z.infer<typeof libraryItemCreateSchema>;

export const libraryItemSchema = z.object({
  id: uuid,
  title_en: z.string(),
  title_hi: z.string(),
  description_en: z.string(),
  description_hi: z.string(),
  type: z.enum(LIBRARY_CONTENT_TYPES),
  access_tier: z.enum(LIBRARY_ACCESS_TIERS),
  embed_url: z.string().url().nullable(),
  asset_id: uuid.nullable(),
  tags: z.array(z.string()),
  created_at: isoDatetime,
  updated_at: isoDatetime,
  deleted_at: isoDatetime.nullable(),
});
export type LibraryItemDto = z.infer<typeof libraryItemSchema>;
