/** User DTOs (SPEC §5.2, §6.1). */

import { z } from 'zod';

import { GENDERS } from '../enums/gender.js';
import { ROLES } from '../enums/role.js';

import { email, isoDatetime, languageCode, phone, uuid } from './common.js';

export const userSchema = z.object({
  id: uuid,
  phone,
  email: email.nullable().optional(),
  role: z.enum(ROLES),
  full_name: z.string().min(1).max(200),
  gender: z.enum(GENDERS).nullable().optional(),
  preferred_language: languageCode,
  profile_photo_asset_id: uuid.nullable().optional(),
  /** Single blanket gallery opt-in covering all linked children (CLAUDE.md Q6). */
  gallery_visibility_opt_in: z.boolean(),
  created_at: isoDatetime,
  updated_at: isoDatetime,
});
export type UserDto = z.infer<typeof userSchema>;

export const userUpdateSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  email: email.nullable().optional(),
  gender: z.enum(GENDERS).nullable().optional(),
  preferred_language: languageCode.optional(),
  profile_photo_asset_id: uuid.nullable().optional(),
  gallery_visibility_opt_in: z.boolean().optional(),
});
export type UserUpdateDto = z.infer<typeof userUpdateSchema>;
