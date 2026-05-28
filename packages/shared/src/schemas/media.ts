/** Media DTOs (SPEC §5.21, §6.24, §2.6 — signed-URL upload flow). */

import { z } from 'zod';

import { MEDIA_KINDS, MEDIA_STATUSES } from '../enums/media.js';

import { isoDatetime, uuid } from './common.js';

export const presignUploadRequestSchema = z.object({
  kind: z.enum(MEDIA_KINDS),
  mime_type: z.string().min(1).max(200),
  size_bytes: z.number().int().min(1).max(2_000_000_000), // 2 GB cap
  /** Optional checksum the client computed locally — server enforces on finalise. */
  checksum_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});
export type PresignUploadRequestDto = z.infer<typeof presignUploadRequestSchema>;

export const presignUploadResponseSchema = z.object({
  asset_id: uuid,
  upload_url: z.string().url(),
  /** Headers the client MUST include with the PUT request. */
  upload_headers: z.record(z.string(), z.string()),
  /** Seconds until upload_url stops working. */
  expires_in_seconds: z.number().int().positive(),
});
export type PresignUploadResponseDto = z.infer<typeof presignUploadResponseSchema>;

export const finalizeUploadSchema = z.object({
  asset_id: uuid,
  /** SHA-256 of the uploaded bytes (mandatory on finalise). */
  checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});
export type FinalizeUploadDto = z.infer<typeof finalizeUploadSchema>;

export const mediaAssetSchema = z.object({
  id: uuid,
  kind: z.enum(MEDIA_KINDS),
  status: z.enum(MEDIA_STATUSES),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  duration_seconds: z.number().int().nullable(),
  /** Signed URL — short-TTL; clients should not cache. */
  url: z.string().url().nullable(),
  thumbnail_url: z.string().url().nullable(),
  created_at: isoDatetime,
});
export type MediaAssetDto = z.infer<typeof mediaAssetSchema>;
