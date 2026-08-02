-- Store canonical Content-Type at upload time (audit / future media-kind).
-- Serve path still uses extension → MIME_BY_EXT; no DB round-trip on GET.

ALTER TABLE "upload_objects" ADD COLUMN IF NOT EXISTS "content_type" text;--> statement-breakpoint

-- Backfill from key extension (mirrors MIME_BY_EXT in apps/api-server/src/lib/upload.ts).
UPDATE "upload_objects"
SET "content_type" = CASE lower(substring("key" from '\.([^.]+)$'))
  WHEN 'jpg' THEN 'image/jpeg'
  WHEN 'jpeg' THEN 'image/jpeg'
  WHEN 'png' THEN 'image/png'
  WHEN 'webp' THEN 'image/webp'
  WHEN 'gif' THEN 'image/gif'
  WHEN 'heic' THEN 'image/heic'
  WHEN 'heif' THEN 'image/heif'
  WHEN 'pdf' THEN 'application/pdf'
  WHEN 'mp4' THEN 'video/mp4'
  WHEN 'mov' THEN 'video/quicktime'
  WHEN 'webm' THEN 'video/webm'
  WHEN 'mp3' THEN 'audio/mpeg'
  WHEN 'm4a' THEN 'audio/mp4'
  WHEN 'wav' THEN 'audio/wav'
  WHEN 'weba' THEN 'audio/webm'
  WHEN 'ogg' THEN 'audio/ogg'
  ELSE NULL
END
WHERE "content_type" IS NULL;
