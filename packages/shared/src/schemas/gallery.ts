/** Gallery DTOs (SPEC §6.11, CLAUDE.md Q6 — blanket per-parent opt-in). */

import { z } from 'zod';

import { isoDatetime, uuid } from './common.js';

export const galleryItemSchema = z.object({
  id: uuid,
  asset_id: uuid,
  caption_en: z.string().max(500).nullable(),
  caption_hi: z.string().max(500).nullable(),
  student_id: uuid.nullable(),
  centre_id: uuid.nullable(),
  /** Hidden when ANY child's parent has opted-out blanket gallery visibility. */
  hidden: z.boolean(),
  featured: z.boolean(),
  created_at: isoDatetime,
});
export type GalleryItemDto = z.infer<typeof galleryItemSchema>;

export const setGalleryConsentSchema = z.object({
  /** True = my children appear in galleries; false = hide them everywhere. */
  gallery_visibility_opt_in: z.boolean(),
});
export type SetGalleryConsentDto = z.infer<typeof setGalleryConsentSchema>;
