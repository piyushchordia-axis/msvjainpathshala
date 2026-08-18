-- Section 17 v3 §17.1.3 — Tarj draft mirrors.
--
-- 0073 added the published tarj_en / tarj_hi columns. Every other editable
-- field on library_items carries a draft_* twin, and publishItem() copies
-- draft → published while bumping content_version. Without these two columns a
-- Tarj could only be written straight to the live row, bypassing the draft
-- gate that every other library field goes through — an unreviewed edit
-- appearing to readers immediately, and no content_version bump to tell the
-- offline clients their copy is stale.
--
-- Backfill from the published value so existing rows open in the editor
-- showing what is currently live, rather than an empty field that would blank
-- the Tarj on the next publish.

ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "draft_tarj_en" text;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "draft_tarj_hi" text;--> statement-breakpoint

UPDATE "library_items"
   SET "draft_tarj_en" = "tarj_en"
 WHERE "draft_tarj_en" IS NULL AND "tarj_en" IS NOT NULL;--> statement-breakpoint

UPDATE "library_items"
   SET "draft_tarj_hi" = "tarj_hi"
 WHERE "draft_tarj_hi" IS NULL AND "tarj_hi" IS NOT NULL;
