/** `media_kind_enum`, `media_status_enum` (SPEC §5.1). */

export const MEDIA_KINDS = [
  'niyam_proof',
  'student_photo',
  'shikshak_photo',
  'sanchalak_photo',
  'library_pdf',
  'library_audio',
  'library_image',
  'homework_attachment',
  'notice_attachment',
  'gallery_featured',
  'misc',
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = [
  'pending',
  'uploaded',
  'processing',
  'ready',
  'failed',
  'quarantined',
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];
