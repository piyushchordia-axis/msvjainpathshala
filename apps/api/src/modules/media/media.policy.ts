/**
 * Per-`media_kind` upload policy (SPEC §10.1, §10.5).
 *
 * Each MediaKind maps to:
 *   - `bucket`         — which of the 4 buckets the object lands in
 *   - `allowed_mimes`  — whitelist enforced on sign-upload + verified by
 *                        file-type sniffing in the processing worker
 *   - `max_bytes`      — hard size cap; sign-upload returns 413 above it
 *                        (per-MIME variants exist for niyam_proof, where
 *                        videos get a 100MB cap vs 25MB for images)
 *   - `allowed_roles`  — who can produce this kind of media. `'*'` means
 *                        any authenticated role; otherwise an array of
 *                        Role keys.
 *
 * Sizes are in BYTES — easier to compare against HEAD ContentLength.
 *
 * Prompt limits (Step 11):
 *   student_photo     5MB
 *   niyam_submission  25MB image / 100MB video
 *   library_pdf       50MB
 *
 * Mapped onto the existing MediaKind enum:
 *   - 'student_photo' / 'shikshak_photo' / 'sanchalak_photo' → 5MB
 *   - 'niyam_proof'                                          → 25MB image / 100MB video
 *   - 'library_pdf'                                          → 50MB
 *   - 'library_audio' / 'library_image' / 'homework_attachment' /
 *     'notice_attachment' / 'gallery_featured' / 'misc'      → 25MB default
 */

import type { StorageBucketKind } from '../../core/storage/storage.types';
import type { MediaKind, Role } from '@jp/shared';

const MB = 1_048_576;

export const PRESIGN_PUT_TTL_SECONDS = 300; // SPEC §10.1 step 5

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
const AUDIO_MIMES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav'] as const;
const PDF_MIMES = ['application/pdf'] as const;

export interface KindLimit {
  bucket: StorageBucketKind;
  allowed_mimes: readonly string[];
  /**
   * Hard cap on object size. For kinds whose MIME range spans image+video
   * (niyam_proof), `max_bytes_by_mime` overrides the default per-MIME.
   */
  max_bytes: number;
  max_bytes_by_mime?: Record<string, number>;
  /** `'*'` allows any authenticated role; otherwise the explicit list. */
  allowed_roles: '*' | readonly Role[];
}

export const KIND_LIMITS: Record<MediaKind, KindLimit> = {
  student_photo: {
    bucket: 'private',
    allowed_mimes: IMAGE_MIMES,
    max_bytes: 5 * MB,
    allowed_roles: ['parent', 'sanchalak', 'shikshak', 'city_admin', 'state_admin', 'super_admin'],
  },
  shikshak_photo: {
    bucket: 'private',
    allowed_mimes: IMAGE_MIMES,
    max_bytes: 5 * MB,
    allowed_roles: ['shikshak', 'sanchalak', 'city_admin', 'state_admin', 'super_admin'],
  },
  sanchalak_photo: {
    bucket: 'private',
    allowed_mimes: IMAGE_MIMES,
    max_bytes: 5 * MB,
    allowed_roles: ['sanchalak', 'city_admin', 'state_admin', 'super_admin'],
  },
  niyam_proof: {
    bucket: 'private',
    allowed_mimes: [...IMAGE_MIMES, ...VIDEO_MIMES],
    max_bytes: 100 * MB,
    max_bytes_by_mime: {
      'image/jpeg': 25 * MB,
      'image/png': 25 * MB,
      'image/webp': 25 * MB,
      'image/heic': 25 * MB,
      'image/heif': 25 * MB,
      'video/mp4': 100 * MB,
      'video/quicktime': 100 * MB,
      'video/webm': 100 * MB,
    },
    allowed_roles: ['parent', 'student', 'shikshak', 'sanchalak', 'city_admin'],
  },
  library_pdf: {
    bucket: 'public',
    allowed_mimes: PDF_MIMES,
    max_bytes: 50 * MB,
    allowed_roles: ['city_admin', 'state_admin', 'super_admin'],
  },
  library_audio: {
    bucket: 'public',
    allowed_mimes: AUDIO_MIMES,
    max_bytes: 50 * MB,
    allowed_roles: ['city_admin', 'state_admin', 'super_admin'],
  },
  library_image: {
    bucket: 'public',
    allowed_mimes: IMAGE_MIMES,
    max_bytes: 10 * MB,
    allowed_roles: ['city_admin', 'state_admin', 'super_admin'],
  },
  homework_attachment: {
    bucket: 'private',
    allowed_mimes: [...IMAGE_MIMES, ...PDF_MIMES],
    max_bytes: 25 * MB,
    allowed_roles: ['shikshak', 'sanchalak', 'city_admin', 'state_admin', 'super_admin'],
  },
  notice_attachment: {
    bucket: 'private',
    allowed_mimes: [...IMAGE_MIMES, ...PDF_MIMES],
    max_bytes: 25 * MB,
    allowed_roles: ['sanchalak', 'city_admin', 'state_admin', 'super_admin'],
  },
  gallery_featured: {
    bucket: 'private',
    allowed_mimes: IMAGE_MIMES,
    max_bytes: 10 * MB,
    allowed_roles: ['sanchalak', 'city_admin', 'state_admin', 'super_admin'],
  },
  misc: {
    bucket: 'private',
    allowed_mimes: [...IMAGE_MIMES, ...PDF_MIMES],
    max_bytes: 25 * MB,
    allowed_roles: '*',
  },
};

export const KIND_BUCKET: Record<MediaKind, StorageBucketKind> = Object.fromEntries(
  (Object.keys(KIND_LIMITS) as MediaKind[]).map((k) => [k, KIND_LIMITS[k].bucket]),
) as Record<MediaKind, StorageBucketKind>;

export function isAllowedMime(kind: MediaKind, mime: string): boolean {
  return (KIND_LIMITS[kind].allowed_mimes as readonly string[]).includes(mime);
}

export function maxSizeFor(kind: MediaKind, mime: string): number {
  const limit = KIND_LIMITS[kind];
  return limit.max_bytes_by_mime?.[mime] ?? limit.max_bytes;
}

export function isAllowedRoleForKind(kind: MediaKind, role: Role): boolean {
  const roles = KIND_LIMITS[kind].allowed_roles;
  if (roles === '*') return true;
  return (roles as readonly Role[]).includes(role);
}

/**
 * Extension picked from MIME — used by `StorageService.buildObjectKey()`.
 * Defaults to 'bin' so an unknown MIME (already rejected by isAllowedMime)
 * doesn't produce a key like `foo/2025/06/<uuid>.undefined`.
 */
export function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
  };
  return map[mime] ?? 'bin';
}
